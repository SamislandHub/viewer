import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AppSettings {
  console: boolean
  cursor: boolean
  pin: boolean
}

const defaults: AppSettings = { console: false, cursor: false, pin: false }

/** Tiny JSON store persisted under data/settings.json. */
export class SettingsStore {
  private readonly path: string
  private data: AppSettings = { ...defaults }

  constructor(baseDir: string) {
    this.path = join(baseDir, 'data', 'settings.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        this.data = { ...defaults, ...JSON.parse(readFileSync(this.path, 'utf8')) }
      }
    } catch { /* keep defaults on corrupt file */ }
  }

  get(): AppSettings { return { ...this.data } }

  set(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch }
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.data, null, 2))
    } catch { /* persistence must never break the app */ }
    return this.get()
  }
}
