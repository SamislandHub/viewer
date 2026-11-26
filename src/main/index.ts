import { app, BrowserWindow, ipcMain } from 'electron'
import { basename, join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { TabbedBrowser } from './browser'
import { VirtualMouse } from './virtual-mouse'
import { VirtualKeyboard } from './virtual-keyboard'
import { ResourceMonitor } from './resource-monitor'
import type { Point } from '@shared/types'

// Keep this app's Chromium profile separate from other Electron apps.
app.setPath('userData', join(process.cwd(), 'data', 'user-data'))

const logFile = join(process.cwd(), 'logs', 'app.log')
function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  console.log(message)
  try {
    mkdirSync(join(process.cwd(), 'logs'), { recursive: true })
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

function bootstrap(): void {
  log('bootstrap start')
  const browser = new TabbedBrowser()
  browser.onLoadEvent = msg => log(msg)
  browser.onFileChooser = request => {
    mouse.setTargetOverride(browser.getCursorWebContents())
    browser.showFileChooser(request)
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
  // The cursor is only meaningful on a real page, not on the new-tab page.
  const applyCursorVisibility = () => {
    const visible = !browser.isActivePageBlank() && mouse.isVisible()
    browser.setCursorVisible(visible)
    send('cursor:visible', visible)
  }

  let lastActiveId: number | null = null
  resources.onUpdate = () => {
    const id = activeWebContentsId()
    if (id) send('resources:update', resources.list(id))
  }

  browser.onTabsChange = (tabs, activeId) => {
    send('tabs:change', { tabs, activeId })
    const wcId = activeWebContentsId()
    if (wcId) send('resources:update', resources.list(wcId))
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
  mouse.onMove = point => browser.setCursorPosition(point)
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
  ipcMain.handle('tab:list', async () => browser.list())

  // navigation
  ipcMain.handle('browser:load', async (_e, input: string) => {
    const url = normalizeInput(input)
    if (url) await browser.load(url)
  })
  ipcMain.handle('browser:back', async () => browser.back())
  ipcMain.handle('browser:forward', async () => browser.forward())
  ipcMain.handle('browser:reload', async () => browser.reload())

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
