import { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, nativeImage, screen, session, shell, type NativeImage } from 'electron'
import { basename, join, resolve } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { TabbedBrowser } from './browser'
import { VirtualMouse } from './virtual-mouse'
import { VirtualKeyboard } from './virtual-keyboard'
import { ResourceMonitor } from './resource-monitor'
import { applyClientHints, installGlobalUserAgent } from './fingerprint'
import { SettingsStore } from './settings-store'
import { BookmarkStore } from './bookmarks'
import { HistoryStore } from './history'
import { DownloadManager } from './downloads'
import type { Point } from '@shared/types'

/**
 * Electron may start with a different working directory (shortcut, preview,
 * portable launch). Resolve the project root from package.json so all data
 * paths stay under the same folder regardless of how the app was launched.
 */
function projectRoot(): string {
  const cwd = process.cwd()
  if (existsSync(join(cwd, 'package.json'))) return cwd
  const fromApp = resolve(app.getAppPath(), '..', '..')
  if (existsSync(join(fromApp, 'package.json'))) return fromApp
  return cwd
}
const root = projectRoot()

// Keep this app's Chromium profile separate from other Electron apps.
app.setPath('userData', join(root, 'data', 'user-data'))

const logFile = join(root, 'logs', 'app.log')
function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  console.log(message)
  try {
    mkdirSync(join(root, 'logs'), { recursive: true })
    appendFileSync(logFile, line)
  } catch { /* logging must never break startup */ }
}

/** Decide whether the title-bar input is a URL or a search query. */
function normalizeInput(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value

  // Local paths, e.g. F:\dir\file.html or \\server\share\file.html
  if (/^[a-z]:[\\/]/i.test(value)) {
    return 'file:///' + encodeURI(value.replace(/\\/g, '/'))
  }
  if (/^\\\\/.test(value)) {
    return 'file://' + encodeURI(value.replace(/\\/g, '/').slice(2))
  }

  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(value)) return `https://${value}`

  const aliases: Record<string, string> = {
    '百度': 'https://www.baidu.com/',
    '谷歌': 'https://www.google.com/',
    '必应': 'https://www.bing.com/',
    '腾讯': 'https://www.qq.com/'
  }
  if (aliases[value]) return aliases[value]

  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`
}

/** Internal pages and blank/new-tab pages should never become bookmarks. */
function bookmarkable(url: string): boolean {
  return !!url && url !== 'about:blank' && !url.startsWith('data:') && !url.startsWith('viewer://')
}

function bootstrap(): void {
  log('bootstrap start root=' + root + ' cwd=' + process.cwd())
  const settingsStore = new SettingsStore(root)
  const bookmarks = new BookmarkStore(root)
  const history = new HistoryStore(root)
  const downloads = new DownloadManager(root)
  downloads.onError = message => log('DOWNLOAD ' + message)
  downloads.attach(session.defaultSession)
  let controlsWindow: BrowserWindow | null = null
  installGlobalUserAgent()
  const browser = new TabbedBrowser()
  browser.onLoadEvent = msg => log(msg)
  browser.onInspectResult = element => send('element:picked', element)
  browser.onInspectChange = active => send('element:mode', active)
  browser.onNavigate = (url, title) => history.add(title, url)

  // Independent controls window: no parent, so a modal JS dialog on the
  // browser window cannot disable its input controls. Created on first open.
  const placeControls = (win: BrowserWindow): void => {
    const main = browser.window.getBounds()
    const area = screen.getDisplayMatching(main).workArea
    const gap = 8
    const [width, height] = win.getSize()
    const x = Math.min(main.x + main.width + gap, area.x + area.width - width - gap)
    const y = Math.max(area.y, Math.min(main.y, area.y + area.height - height))
    win.setPosition(x, y)
  }

  const ensureControlsWindow = (): BrowserWindow => {
    if (controlsWindow && !controlsWindow.isDestroyed()) return controlsWindow
    const mainBounds = browser.window.getBounds()
    const area = screen.getDisplayMatching(mainBounds).workArea
    const height = Math.min(mainBounds.height, area.height)
    const win = new BrowserWindow({
      width: 340,
      height,
      title: 'Viewer Controls',
      backgroundColor: '#f7f8fa',
      frame: false,
      titleBarStyle: 'hidden',
      alwaysOnTop: false,
      skipTaskbar: true,
      show: false,
      resizable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    win.on('closed', () => {
      controlsWindow = null
      send('controls:state', false)
    })
    placeControls(win)
    void win.loadFile(join(__dirname, '../renderer/controls.html'))
    win.webContents.once('did-finish-load', () => {
      const id = activeWebContentsId()
      if (id) sendControls('resources:update', resources.list(id))
      sendControls('cursor:visible', !browser.isActivePageBlank() && mouse.isVisible())
    })
    controlsWindow = win
    return win
  }

  const sendControls = (channel: string, payload?: unknown) => {
    const wc = controlsWindow?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  browser.refreshLayout()
  log('browser window created')

  const mouse = new VirtualMouse(() => {
    const tab = browser.active()
    const tabId = browser.activeIdValue()
    if (!tab || tabId === null) return undefined
    const rect = browser.pageRect()
    return {
      tabId,
      webContents: tab.view.webContents,
      viewport: { width: rect.width, height: rect.height }
    }
  })

  // Restore persisted settings at startup.
  const savedSettings = settingsStore.get()
  if (savedSettings.pin) browser.window.setAlwaysOnTop(true, 'floating')
  if (savedSettings.cursor) mouse.setVisible(true)

  browser.onFileChooser = request => {
    mouse.setTargetOverride(browser.getCursorWebContents())
    browser.showFileChooser(request)
  }

  const keyboard = new VirtualKeyboard(() =>
    mouse.getInputWebContents() ?? browser.active()?.view.webContents
  )

  const resources = new ResourceMonitor()
  const activeWebContentsId = () => browser.active()?.view.webContents.id ?? 0
  resources.attach()

  const renderer = () => browser.window.webContents
  const send = (channel: string, payload?: unknown) => {
    if (!renderer().isDestroyed()) renderer().send(channel, payload)
  }
  downloads.onUpdate = list => browser.broadcast('downloads:update', list)
  history.onUpdate = list => browser.broadcast('history:update', list)
  bookmarks.onUpdate = list => browser.broadcast('bookmarks:update', list)
  // The cursor is only meaningful on a real page, not on the new-tab page.
  const applyCursorVisibility = () => {
    const visible = !browser.isActivePageBlank() && mouse.isVisible()
    browser.setCursorVisible(visible)
    sendControls('cursor:visible', visible)
  }
  browser.onCursorLayerReady = () => applyCursorVisibility()

  let lastActiveId: number | null = null
  resources.onUpdate = () => {
    const id = activeWebContentsId()
    if (id) sendControls('resources:update', resources.list(id))
  }

  browser.onTabsChange = (tabs, activeId, hasPage) => {
    send('tabs:change', { tabs, activeId, hasPage })
    const wcId = activeWebContentsId()
    if (wcId) sendControls('resources:update', resources.list(wcId))
    if (activeId !== lastActiveId) {
      lastActiveId = activeId
      if (activeId !== null) {
        mouse.activate()
        browser.syncChooserForActiveTab()
        mouse.setTargetOverride(
          browser.isFileChooserOpen() ? browser.getCursorWebContents() : undefined
        )
      }
    }
    applyCursorVisibility()
  }
  mouse.onMove = point => {
    browser.setCursorPosition(point)
    sendControls('cursor:move', point)
  }
  mouse.onVisibility = () => applyCursorVisibility()

  // The cursor is hidden by default and after any window geometry change:
  // a resize/maximize moves the page out from under the saved cursor position.
  const hideCursor = () => mouse.setVisible(false)
  browser.window.on('resize', hideCursor)
  browser.window.on('maximize', hideCursor)
  browser.window.on('unmaximize', hideCursor)
  browser.window.on('restore', hideCursor)
  browser.window.on('show', applyCursorVisibility)

  // window controls
  ipcMain.handle('win:minimize', async () => browser.minimize())
  ipcMain.handle('win:maximize', async () => browser.toggleMaximize())
  ipcMain.handle('win:close', async () => browser.close())
  ipcMain.handle('win:isMaximized', async () => browser.isMaximized())
  ipcMain.handle('sidebar:width', async (_e, width: number) => browser.setLeftPanelWidth(width))

  const getSettingsState = () => ({
    console: !!controlsWindow && !controlsWindow.isDestroyed() && controlsWindow.isVisible(),
    cursor: mouse.isVisible(),
    pin: browser.window.isAlwaysOnTop(),
    ua: app.userAgentFallback,
    platform: process.platform,
    languages: 'zh-CN, zh, en',
    brands: 'Chromium / Google Chrome'
  })
  const broadcastSettings = () => {
    const state = getSettingsState()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send('settings:changed', state)
    }
  }
  ipcMain.handle('settings:open', async () => browser.openSettingsTab())
  ipcMain.handle('internal:open', async (_e, url: string) => browser.openInternalTab(url))
  ipcMain.handle('settings:state', async () => getSettingsState())
  ipcMain.handle('settings:action', async (_e, action: string, value: boolean) => {
    switch (action) {
      case 'cursor':
        mouse.setVisible(value)
        applyCursorVisibility()
        settingsStore.set({ cursor: value })
        break
      case 'pin':
        browser.window.setAlwaysOnTop(value, 'floating')
        settingsStore.set({ pin: value })
        break
      case 'console': {
        if (value) showControls()
        else controlsWindow?.close()
        settingsStore.set({ console: value })
        break
      }
      case 'clear':
        resources.clear(activeWebContentsId())
        return
    }
    broadcastSettings()
  })

  ipcMain.handle('win:pin', async (_e, pinned: boolean) => {
    browser.window.setAlwaysOnTop(pinned, 'floating')
  })
  ipcMain.handle('win:isPinned', async () => browser.window.isAlwaysOnTop())

  // Custom dialogs / file chooser (driven by CDP, no page JS injection)
  ipcMain.handle('filechooser:respond', async (_e, backendNodeId: number, files: string[]) => {
    mouse.setTargetOverride(undefined)
    browser.respondFileChooser(backendNodeId, files)
  })
  ipcMain.handle('fs:list', async (_e, dir: string) => {
    const target = dir || 'F:\\AI\\AIbrowser\\test'
    const entries = await readdir(target, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      path: join(target, entry.name),
      isDirectory: entry.isDirectory()
    })).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  })
  ipcMain.handle('fs:basename', async (_e, p: string) => basename(p))
  ipcMain.handle('fs:drives', async () => {
    const drives: string[] = []
    for (let code = 65; code <= 90; code++) {
      const root = String.fromCharCode(code) + ':\\'
      if (existsSync(root)) drives.push(root)
    }
    return drives
  })

  // tabs — each tab is its own BrowserView / webContents
  ipcMain.handle('tab:new', async () => browser.createTab())
  ipcMain.handle('tab:close', async (_e, id: number) => {
    browser.closeTab(id)
    mouse.remove(id)
  })
  ipcMain.handle('tab:activate', async (_e, id: number) => browser.activateTab(id))
  ipcMain.handle('tab:list', async () => browser.visibleList())
  ipcMain.handle('tab:hasPage', async () => browser.list().length > 0)

  // navigation
  ipcMain.handle('browser:load', async (_e, input: string) => {
    const url = normalizeInput(input)
    if (url) await browser.load(url)
  })
  ipcMain.handle('browser:back', async () => browser.back())
  ipcMain.handle('browser:forward', async () => browser.forward())
  ipcMain.handle('browser:reload', async () => browser.reload())
  ipcMain.handle('browser:home', async () => browser.home())

  // screenshots — UI lives on the topmost cursor layer, capture in main
  ipcMain.handle('screenshot:begin', async () => browser.beginScreenshot())
  ipcMain.handle('screenshot:end', async () => browser.endScreenshot())
  ipcMain.handle('screenshot:capture', async (
    _e, options?: { rect?: { x: number; y: number; width: number; height: number }; fullPage?: boolean }
  ) => {
    const wc = browser.active()?.view.webContents
    if (!wc || wc.isDestroyed()) throw new Error('没有可截图的页面')
    let image: NativeImage
    if (options?.fullPage) {
      const buffer = await browser.captureFullPage()
      if (!buffer?.length) throw new Error('整页截图失败')
      image = nativeImage.createFromBuffer(buffer)
    } else if (options?.rect && options.rect.width > 0 && options.rect.height > 0) {
      image = await wc.capturePage(options.rect)
    } else {
      image = await wc.capturePage()
    }
    const dir = join(root, 'data', 'screenshots')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const suffix = options?.fullPage ? '-full' : options?.rect ? '-area' : ''
    const path = join(dir, `screenshot-${stamp}${suffix}.png`)
    writeFileSync(path, image.toPNG())
    return { path, dataUrl: image.toDataURL() }
  })
  ipcMain.handle('screenshot:copy', async (_e, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('图片为空')
    const png = image.toPNG()
    const bytes = new Uint8Array(png)
    await clipboard.write([new ClipboardItem({
      'image/png': new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })
    })])
  })
  ipcMain.handle('screenshot:open', async (_e, path: string) => shell.openPath(path))
  ipcMain.handle('screenshot:reveal', async (_e, path: string) => shell.showItemInFolder(path))

  // bookmarks / favorites
  ipcMain.handle('bookmark:list', async () => bookmarks.list())
  ipcMain.handle('bookmark:toggle', async () => {
    const tab = browser.active()
    const url = tab?.url ?? ''
    if (!bookmarkable(url)) return { bookmarked: false, bookmarks: bookmarks.list() }
    const wasBookmarked = bookmarks.has(url)
    if (wasBookmarked) bookmarks.removeByUrl(url)
    else bookmarks.add(tab?.title ?? '', url)
    return { bookmarked: !wasBookmarked, bookmarks: bookmarks.list() }
  })
  ipcMain.handle('bookmark:remove', async (_e, id: string) => bookmarks.remove(id))
  ipcMain.handle('bookmark:clear', async () => bookmarks.clear())
  ipcMain.handle('bookmark:open', async (_e, url: string) => browser.load(url))

  // browsing history
  ipcMain.handle('history:list', async () => history.list())
  ipcMain.handle('history:remove', async (_e, id: string) => history.remove(id))
  ipcMain.handle('history:clear', async () => history.clear())
  ipcMain.handle('history:open', async (_e, url: string) => browser.load(url))

  // downloads
  ipcMain.handle('downloads:list', async () => downloads.list())
  ipcMain.handle('downloads:cancel', async (_e, id: string) => downloads.cancel(id))
  ipcMain.handle('downloads:open', async (_e, id: string) => downloads.open(id))
  ipcMain.handle('downloads:reveal', async (_e, id: string) => downloads.reveal(id))
  ipcMain.handle('downloads:remove', async (_e, id: string) => downloads.remove(id))
  ipcMain.handle('downloads:clearCompleted', async () => downloads.clearCompleted())
  ipcMain.handle('downloads:openFolder', async () => downloads.openFolder())
  ipcMain.handle('downloads:resume', async (_e, id: string) => downloads.resume(id))

  // element selection (CDP inspect mode)
  ipcMain.handle('element:startPick', async () => browser.startElementPick())
  ipcMain.handle('element:stopPick', async () => browser.stopElementPick())

  // virtual mouse
  // VirtualMouse works in page-local coordinates. For screen-space input,
  // subtract the page viewport origin.
  const resolvePoint = (x: number, y: number, space: 'page' | 'screen'): Point => {
    if (space === 'screen') {
      const rect = browser.pageRect()
      return { x: x - rect.x, y: y - rect.y }
    }
    return { x, y }
  }
  ipcMain.handle('vm:move', async (_e, x: number, y: number, space: 'page' | 'screen') => {
    browser.focusPage()
    await mouse.moveTo(resolvePoint(x, y, space))
  })
  ipcMain.handle('vm:click', async (_e, button?: 'left' | 'right', clickCount?: number) => {
    browser.focusPage()
    mouse.click(button ?? 'left', clickCount ?? 1)
  })
  ipcMain.handle('vm:moveClick', async (
    _e, x: number, y: number, space: 'page' | 'screen', button?: 'left' | 'right', clickCount?: number
  ) => {
    browser.focusPage()
    await mouse.moveAndClick(resolvePoint(x, y, space), button ?? 'left', clickCount ?? 1)
  })
  ipcMain.handle('vm:nudge', async (_e, dx: number, dy: number) => {
    browser.focusPage()
    mouse.nudge(dx, dy)
  })
  ipcMain.handle('vm:scroll', async (_e, deltaX: number, deltaY: number) => {
    browser.focusPage()
    mouse.scroll(deltaX, deltaY)
  })
  ipcMain.handle('kb:type', async (_e, text: string) => keyboard.typeText(text))
  ipcMain.handle('kb:press', async (_e, key: string) => keyboard.pressKey(key))

  ipcMain.handle('resources:list', async () => resources.list(activeWebContentsId()))
  ipcMain.handle('resources:clear', async () => resources.clear(activeWebContentsId()))
  ipcMain.handle('resources:clearAll', async () => resources.clearAll())

  const showControls = (): void => {
    const win = ensureControlsWindow()
    placeControls(win)
    win.showInactive()
    win.focus()
    send('controls:state', true)
  }
  ipcMain.handle('controls:show', async () => showControls())
  ipcMain.handle('controls:toggle', async () => {
    if (controlsWindow && !controlsWindow.isDestroyed() && controlsWindow.isVisible()) {
      controlsWindow.close()
    } else {
      showControls()
    }
  })
  ipcMain.handle('controls:isOpen', async () =>
    !!controlsWindow && !controlsWindow.isDestroyed() && controlsWindow.isVisible()
  )
  ipcMain.handle('controls:minimize', async () => controlsWindow?.minimize())
  ipcMain.handle('controls:close', async () => controlsWindow?.close())
  ipcMain.handle('controls:pin', async (_e, pinned: boolean) => {
    controlsWindow?.setAlwaysOnTop(pinned, 'floating')
  })
  ipcMain.handle('controls:isPinned', async () => controlsWindow?.isAlwaysOnTop() ?? true)
  ipcMain.handle('vm:position', async () => mouse.getPosition())
  ipcMain.handle('vm:visible', async (_e, visible: boolean) => {
    mouse.setVisible(visible)
  })
  ipcMain.handle('vm:center', async () => {
    const rect = browser.pageRect()
    mouse.jumpTo({ x: rect.width / 2, y: rect.height / 2 })
  })

  const initialUrl = process.env.AI_BROWSER_INITIAL_URL
  if (initialUrl) {
    log('loading initial URL: ' + initialUrl)
    void browser.load(initialUrl).catch(err => log('initial URL FAILED: ' + String(err)))
  }

  // electron-vite sets ELECTRON_RENDERER_URL with the actual port (5173/5174...).
  // Allow explicit override via AI_BROWSER_RENDERER_URL / VITE_PORT.
  const rendererUrl = process.env.AI_BROWSER_RENDERER_URL
    || process.env.ELECTRON_RENDERER_URL
    || `http://localhost:${process.env.VITE_PORT || '5173'}`
  const localRenderer = () => browser.window.loadFile(join(__dirname, '../renderer/index.html'))
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('renderer load timeout')), ms))
    ])
  const load = withTimeout(browser.window.loadURL(rendererUrl), 4000).catch(error => {
    log(`renderer URL failed (${rendererUrl}): ${String(error)}, falling back to built files`)
    return localRenderer()
  })
  void load.then(
    () => {
      log('renderer loaded')
      browser.sendPageToBack()
    },
    err => log('renderer load FAILED: ' + String(err))
  )

  browser.window.webContents.on('did-finish-load', () => browser.sendPageToBack())

  browser.window.on('closed', () => {
    log('window closed')
    mouse.release()
  })
  log('bootstrap done, window visible=' + browser.window.isVisible())
}

process.on('uncaughtException', err => log('uncaughtException: ' + (err?.stack ?? String(err))))
process.on('unhandledRejection', err => log('unhandledRejection: ' + String(err)))

app.whenReady().then(bootstrap, err => log('app ready failed: ' + String(err)))
app.on('window-all-closed', () => {
  log('window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => log('before-quit'))

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) bootstrap()
})
