import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { shell, type DownloadItem, type Session } from 'electron'

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'failed' | 'interrupted'

export interface DownloadRecord {
  id: string
  filename: string
  url: string
  path: string
  totalBytes: number
  receivedBytes: number
  state: DownloadState
  startTime: number
  endTime?: number
  error?: string
}

const MAX_RECORDS = 100

function safeFilename(name: string): string {
  const cleaned = (name || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return cleaned || 'download'
}

/**
 * Takes over Electron's download events: every file is saved to data/downloads
 * with no native Save dialog (dialogs are disabled app-wide), and progress is
 * pushed to the shell renderer for an in-app download manager.
 */
export class DownloadManager {
  readonly defaultDirectory: string
  directory: string
  private readonly items: DownloadRecord[] = []
  private readonly active = new Map<string, DownloadItem>()

  onUpdate?: (items: DownloadRecord[]) => void
  onError?: (message: string) => void

  constructor(baseDir: string, initialDir = '') {
    this.defaultDirectory = join(baseDir, 'data', 'downloads')
    this.directory = initialDir || this.defaultDirectory
    this.ensureDirectory()
  }

  /** Empty path restores the default. Active downloads keep their original save path. */
  setDirectory(dir: string): void {
    this.directory = dir.trim() || this.defaultDirectory
    this.ensureDirectory()
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true })
  }

  /** Attach once to the shared session (will-download is a session event). */
  attach(target: Session): void {
    target.on('will-download', (_event, item) => {
      const filename = safeFilename(item.getFilename())
      const path = this.uniquePath(filename)
      try { item.setSavePath(path) } catch (error) { this.onError?.('setSavePath: ' + String(error)) }

      const record: DownloadRecord = {
        id: randomUUID(),
        filename: basename(path),
        url: item.getURL(),
        path,
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        state: 'progressing',
        startTime: Date.now()
      }
      this.items.unshift(record)
      this.active.set(record.id, item)
      if (this.items.length > MAX_RECORDS) this.items.length = MAX_RECORDS
      this.emit()

      item.on('updated', (_e, state) => {
        record.totalBytes = item.getTotalBytes()
        record.receivedBytes = item.getReceivedBytes()
        if (state === 'interrupted') {
          record.state = 'interrupted'
          record.error = '下载被中断'
        }
        this.emit()
      })

      item.on('done', (_e, state) => {
        record.totalBytes = item.getTotalBytes()
        record.receivedBytes = item.getReceivedBytes()
        record.endTime = Date.now()
        record.state = state === 'completed' ? 'completed'
          : state === 'cancelled' ? 'cancelled' : 'interrupted'
        if (state === 'interrupted') record.error = '下载被中断且无法继续'
        this.active.delete(record.id)
        this.emit()
      })
    })
  }

  private uniquePath(filename: string): string {
    let candidate = join(this.directory, filename)
    if (!existsSync(candidate)) return candidate
    const ext = extname(filename)
    const stem = filename.slice(0, filename.length - ext.length)
    for (let i = 1; i < 10000; i++) {
      candidate = join(this.directory, `${stem} (${i})${ext}`)
      if (!existsSync(candidate)) return candidate
    }
    return join(this.directory, `${randomUUID()}${ext}`)
  }

  private emit(): void {
    this.onUpdate?.(this.list())
  }

  list(): DownloadRecord[] { return this.items.map(item => ({ ...item })) }

  cancel(id: string): void {
    this.active.get(id)?.cancel()
  }

  resume(id: string): void {
    const item = this.active.get(id)
    if (item?.canResume()) {
      const record = this.items.find(entry => entry.id === id)
      if (record) {
        record.state = 'progressing'
        record.error = undefined
        record.endTime = undefined
        this.emit()
      }
      item.resume()
    }
  }

  async open(id: string): Promise<string | undefined> {
    const record = this.items.find(item => item.id === id)
    if (!record || !existsSync(record.path)) return '文件不存在'
    return shell.openPath(record.path)
  }

  reveal(id: string): void {
    const record = this.items.find(item => item.id === id)
    if (record) shell.showItemInFolder(record.path)
  }

  async openFolder(): Promise<string | undefined> {
    try {
      mkdirSync(this.directory, { recursive: true })
    } catch (error) {
      return `无法创建下载目录：${String(error)}`
    }
    const error = await shell.openPath(this.directory)
    if (error) this.onError?.(`openFolder ${this.directory}: ${error}`)
    return error
  }

  remove(id: string): void {
    const index = this.items.findIndex(item => item.id === id)
    if (index < 0) return
    this.items.splice(index, 1)
    this.emit()
  }

  clearCompleted(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const state = this.items[i].state
      if (state !== 'progressing' && state !== 'interrupted') this.items.splice(i, 1)
    }
    this.emit()
  }
}
