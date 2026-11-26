import { session } from 'electron'

export type ResourceRecord = {
  id: string
  url: string
  method: string
  resourceType: string
  status: number
  statusText: string
  mimeType: string
  fromCache: boolean
  durationMs: number
  startedAt: number
  webContentsId: number
  error?: string
}

type Pending = { startedAt: number; url: string; method: string; resourceType: string; webContentsId: number }

const MAX_PER_TAB = 500
const IGNORED_URL = /^(devtools:|chrome-extension:|data:|blob:)|localhost:5173/

/**
 * Observes browser network activity through Electron's webRequest API.
 * No CDP, no page JS, no response bodies.
 */
export class ResourceMonitor {
  private readonly pending = new Map<number, Pending>()
  private readonly records = new Map<number, ResourceRecord[]>()
  private sequence = 0
  private notifyTimer: NodeJS.Timeout | null = null

  onUpdate?: () => void

  attach(): void {
    const webRequest = session.defaultSession.webRequest
    const filter = { urls: ['<all_urls>'] }

    // Do NOT register onBeforeRequest: in this Electron build it blocks the
    // main frame from finishing load. Observation-only events are sufficient.
    webRequest.onResponseStarted(filter, details => {
      if (IGNORED_URL.test(details.url)) return
      this.pending.set(details.id, {
        startedAt: details.timestamp ?? Date.now(),
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        webContentsId: details.webContentsId ?? 0
      })
    })

    webRequest.onCompleted(filter, details => {
      const start = this.pending.get(details.id)
      this.pending.delete(details.id)
      if (!start || IGNORED_URL.test(details.url)) return
      this.push({
        id: String(++this.sequence),
        ...start,
        status: details.statusCode,
        statusText: details.statusLine ?? '',
        mimeType: String(details.responseHeaders?.['content-type']?.[0] ?? ''),
        fromCache: details.fromCache ?? false,
        durationMs: Math.max(0, (details.timestamp ?? Date.now()) - start.startedAt)
      })
    })

    webRequest.onErrorOccurred(filter, details => {
      const start = this.pending.get(details.id)
      this.pending.delete(details.id)
      if (!start || IGNORED_URL.test(details.url)) return
      this.push({
        id: String(++this.sequence),
        ...start,
        status: 0,
        statusText: '',
        mimeType: '',
        fromCache: false,
        durationMs: Math.max(0, (details.timestamp ?? Date.now()) - start.startedAt),
        error: details.error
      })
    })
  }

  private push(record: ResourceRecord): void {
    const key = record.webContentsId
    const list = this.records.get(key) ?? []
    list.unshift(record)
    if (list.length > MAX_PER_TAB) list.length = MAX_PER_TAB
    this.records.set(key, list)
    this.scheduleNotify()
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.onUpdate?.()
    }, 200)
  }

  list(webContentsId: number): ResourceRecord[] {
    return [...(this.records.get(webContentsId) ?? [])]
  }

  clear(webContentsId: number): void {
    this.records.delete(webContentsId)
    this.onUpdate?.()
  }

  clearAll(): void {
    this.records.clear()
    this.pending.clear()
    this.onUpdate?.()
  }
}
