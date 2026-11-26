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
}

/**
 * Takes over the native file chooser through CDP, without injecting JS into
 * the page. Electron's own file dialog is not shown because CDP interception
 * is exclusive for this action.
 */
export class FileChooserBridge {
  private attached = false
  private sequence = 0

  onFileChooser?: (request: FileChooserRequest) => void
  onError?: (message: string) => void

  constructor(private readonly wc: WebContents) {}

  attach(): void {
    if (this.attached || this.wc.isDestroyed()) return
    try {
      this.wc.debugger.attach('1.3')
      this.wc.debugger.on('message', async (_event, method, params) => {
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

  detach(): void {
    if (!this.attached) return
    try { this.wc.debugger.detach() } catch { /* ignore */ }
    this.attached = false
  }
}
