import type { WebContents } from 'electron'

export interface FileChooserRequest {
  id: number
  mode: string
  backendNodeId: number
  accept: string[]
  /** webkitdirectory input: pick a folder, not a file. */
  directory: boolean
  /** input has the multiple attribute. */
  multiple: boolean
  /** Optional starting folder for chooser requests opened by internal pages. */
  initialDir?: string
}

export interface InspectedElement {
  tag: string
  id: string
  className: string
  text: string
  outerHTML: string
  width: number
  height: number
}

/**
 * Owns a tab's single CDP debugger session. It takes over the native file
 * chooser and provides DevTools-style element inspection, both without
 * injecting JS into the page. Electron allows only one debugger client per
 * webContents, so both features share this bridge.
 */
export class FileChooserBridge {
  private attached = false
  private inspecting = false
  private sequence = 0

  onFileChooser?: (request: FileChooserRequest) => void
  onInspect?: (element: InspectedElement) => void
  onInspectCancel?: () => void
  onError?: (message: string) => void

  constructor(private readonly wc: WebContents) {}

  attach(): void {
    if (this.attached || this.wc.isDestroyed()) return
    try {
      this.wc.debugger.attach('1.3')
      this.wc.debugger.on('message', async (_event, method, params) => {
        if (method === 'Overlay.inspectNodeRequested') {
          const backendNodeId = Number(params.backendNodeId ?? 0)
          await this.stopInspect()
          if (backendNodeId) {
            try {
              this.onInspect?.(await this.describeNode(backendNodeId))
            } catch (error) {
              this.onError?.('inspect node: ' + String(error))
            }
          }
          return
        }
        if (method === 'Overlay.inspectModeCanceled') {
          if (this.inspecting) {
            this.inspecting = false
            this.onInspectCancel?.()
          }
          return
        }
        if (method !== 'Page.fileChooserOpened') return
        let accept: string[] = Array.isArray(params.accept) ? params.accept.map(String) : []
        let directory = false
        let multiple = false
        const backendNodeId = Number(params.backendNodeId ?? 0)
        // CDP's accept field is often empty; read the input's own accept attribute.
        try {
          const described = await this.wc.debugger.sendCommand('DOM.describeNode', { backendNodeId })
          const attrs = (described?.node?.attributes ?? []) as string[]
          directory = attrs.includes('webkitdirectory') || attrs.includes('directory')
          multiple = attrs.includes('multiple')
          const index = attrs.indexOf('accept')
          if (index >= 0 && attrs[index + 1]) {
            accept = attrs[index + 1].split(',').map(s => s.trim()).filter(Boolean)
          }
        } catch (error) {
          this.onError?.('read accept failed: ' + String(error))
        }
        this.onFileChooser?.({
          id: ++this.sequence,
          mode: String(params.mode ?? 'single'),
          backendNodeId,
          accept,
          directory,
          multiple
        })
      })
      this.enable()
      this.attached = true
    } catch (error) {
      this.onError?.('attach: ' + String(error))
    }
  }

  /** Re-enable after navigation; Chromium resets interception on new documents. */
  refresh(): void {
    if (this.attached) this.enable()
  }

  private enable(): void {
    void this.wc.debugger.sendCommand('Page.enable')
    void this.wc.debugger.sendCommand('DOM.enable')
    void Promise.resolve(this.wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true }))
      .catch(error => this.onError?.('setInterceptFileChooserDialog: ' + String(error)))
  }

  async respond(backendNodeId: number, files: string[]): Promise<void> {
    if (!this.attached || !backendNodeId) return
    try {
      await this.wc.debugger.sendCommand('DOM.setFileInputFiles', { files, backendNodeId })
    } catch (error) {
      this.onError?.('setFileInputFiles: ' + String(error))
    }
  }

  // ---------- element selection (DevTools inspect mode, no page JS) ----------

  async startInspect(): Promise<void> {
    if (!this.attached || this.wc.isDestroyed()) return
    await this.wc.debugger.sendCommand('DOM.enable')
    await this.wc.debugger.sendCommand('Overlay.enable')
    await this.wc.debugger.sendCommand('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: {
        showInfo: true,
        // CDP RGBA takes integer channels (0-255), alpha is a 0-1 float.
        contentColor: { r: 66, g: 140, b: 224, a: 0.35 },
        paddingColor: { r: 89, g: 199, b: 140, a: 0.35 },
        borderColor: { r: 242, g: 148, b: 40, a: 0.9 },
        marginColor: { r: 232, g: 102, b: 133, a: 0.3 }
      }
    })
    this.inspecting = true
  }

  async stopInspect(): Promise<void> {
    if (!this.inspecting) return
    this.inspecting = false
    try {
      // Chromium requires highlightConfig even when disabling inspect mode;
      // omitting it makes setInspectMode fail and the picker stays active.
      await this.wc.debugger.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} })
      await this.wc.debugger.sendCommand('Overlay.disable')
    } catch (error) {
      this.onError?.('stopInspect: ' + String(error))
    }
  }

  isInspecting(): boolean { return this.inspecting }

  /** Chrome-style full-page screenshot via CDP, without touching the page DOM. */
  async captureFullPage(): Promise<Buffer> {
    const metrics = await this.wc.debugger.sendCommand('Page.getLayoutMetrics')
    const size = metrics?.cssContentSize ?? metrics?.contentSize ?? { width: 0, height: 0 }
    const width = Math.max(1, Math.round(size.width))
    const height = Math.max(1, Math.round(size.height))
    const result = await this.wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    })
    return Buffer.from(String(result?.data ?? ''), 'base64')
  }

  private async describeNode(backendNodeId: number): Promise<InspectedElement> {
    const described = await this.wc.debugger.sendCommand('DOM.describeNode', { backendNodeId, depth: 0 })
    const htmlResponse = await this.wc.debugger.sendCommand('DOM.getOuterHTML', { backendNodeId })
    const boxResponse = await this.wc.debugger.sendCommand('DOM.getBoxModel', { backendNodeId }).catch(() => null)
    const node = described?.node ?? {}
    const raw: string[] = Array.isArray(node.attributes) ? node.attributes : []
    const attrs: Record<string, string> = {}
    for (let i = 0; i + 1 < raw.length; i += 2) attrs[raw[i]] = raw[i + 1]
    const outerHTML: string = String(htmlResponse?.outerHTML ?? '')
    const text = outerHTML
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    const box = boxResponse?.model
    return {
      tag: String(node.nodeName ?? '').toLowerCase(),
      id: attrs.id ?? '',
      className: attrs.class ?? '',
      text,
      outerHTML: outerHTML.slice(0, 2000),
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0)
    }
  }

  detach(): void {
    if (!this.attached) return
    try { this.wc.debugger.detach() } catch { /* ignore */ }
    this.attached = false
    this.inspecting = false
  }
}
