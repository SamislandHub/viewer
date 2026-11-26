import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface HistoryEntry {
  id: string
  title: string
  url: string
  visitedAt: number
}

const MAX_ENTRIES = 300

/** Recently visited pages, persisted under data/history.json. */
export class HistoryStore {
  private readonly path: string
  private items: HistoryEntry[] = []

  onUpdate?: (items: HistoryEntry[]) => void

  constructor(baseDir: string) {
    this.path = join(baseDir, 'data', 'history.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (Array.isArray(parsed)) {
        this.items = parsed.filter((entry): entry is HistoryEntry =>
          !!entry && typeof entry.id === 'string' && typeof entry.url === 'string'
        ).map(entry => ({
          id: entry.id,
          url: entry.url,
          title: typeof entry.title === 'string' ? entry.title : entry.url,
          visitedAt: typeof entry.visitedAt === 'number' ? entry.visitedAt : Date.now()
        })).slice(0, MAX_ENTRIES)
      }
    } catch { /* keep an empty list on a corrupt file */ }
  }

  private persist(): void {
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.items, null, 2))
    } catch { /* persistence must never break the app */ }
  }

  list(): HistoryEntry[] { return this.items.map(entry => ({ ...entry })) }

  /** Re-visiting a URL moves it to the top instead of creating a duplicate. */
  add(title: string, url: string): void {
    if (!url) return
    const front = this.items[0]
    if (front && front.url === url && front.title === title) return
    this.items = this.items.filter(entry => entry.url !== url)
    this.items.unshift({ id: randomUUID(), title: title?.trim() || url, url, visitedAt: Date.now() })
    if (this.items.length > MAX_ENTRIES) this.items.length = MAX_ENTRIES
    this.persist()
    this.onUpdate?.(this.list())
  }

  remove(id: string): void {
    this.items = this.items.filter(entry => entry.id !== id)
    this.persist()
    this.onUpdate?.(this.list())
  }

  clear(): void {
    this.items = []
    this.persist()
    this.onUpdate?.(this.list())
  }
}
