import type { BrowserAPI } from '../preload/index'

declare global {
  interface Window {
    api: BrowserAPI
  }
}

export {}
