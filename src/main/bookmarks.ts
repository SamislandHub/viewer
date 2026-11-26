import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Bookmark {
  id: string
  title: string
  url: string
  createdAt: number
}

/** Small JSON-backed bookmark store, persisted under data/bookmarks.json. */
export class BookmarkStore {
  private readonly path: string
  private items: Bookmark[] = []

  onUpdate?: (items: Bookmark[]) => void

  constructor(baseDir: string) {
    this.path = join(baseDir, 'data', 'bookmarks.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (Array.isArray(parsed)) {
        this.items = parsed.filter((b): b is Bookmark =>
          !!b && typeof b.id === 'string' && typeof b.url === 'string'
        ).map(b => ({
          id: b.id,
          url: b.url,
          title: typeof b.title === 'string' ? b.title : b.url,
          createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now()
        }))
      }
    } catch { /* keep an empty list on a corrupt file */ }
  }

  private persist(): void {
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.items, null, 2))
    } catch { /* persistence must never break the app */ }
    this.onUpdate?.(this.list())
  }

  list(): Bookmark[] { return this.items.map(b => ({ ...b })) }

  has(url: string): boolean {
    return this.items.some(b => b.url === url)
  }

  add(title: string, url: string): Bookmark {
    const existing = this.items.find(b => b.url === url)
    if (existing) return { ...existing }
    const bookmark: Bookmark = {
      id: randomUUID(),
      title: title?.trim() || url,
      url,
      createdAt: Date.now()
    }
    this.items.unshift(bookmark)
    this.persist()
    return { ...bookmark }
  }

  remove(id: string): void {
    this.items = this.items.filter(b => b.id !== id)
    this.persist()
  }

  removeByUrl(url: string): void {
    this.items = this.items.filter(b => b.url !== url)
    this.persist()
  }

  clear(): void {
    this.items = []
    this.persist()
  }
}
