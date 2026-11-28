import { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, nativeImage, screen, session, shell, type NativeImage } from 'electron'
import { basename, join, resolve } from 'node:path'
import { appendFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, statfsSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { TextDecoder } from 'node:util'
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
import { kindByExtension, kindByMagic, mimeForImage, type FileKind } from '../shared/file-types'

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

  // Local paths: open the built-in file manager / preview page.
  // e.g. F:\dir\file.html or \\server\share\file.html
  if (/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) {
    const path = value.replace(/\//g, '\\')
    if (existsSync(path)) {
      const scheme = statSync(path).isDirectory() ? 'files' : 'preview'
      return `viewer://${scheme}/${encodeURIComponent(path)}`
    }
    return 'file:///' + encodeURI(value.replace(/\\/g, '/'))
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

/** Convert a file:// URL back to a local path when the file still exists. */
function localFileFromUrl(url: string): string | null {
  const match = url.match(/^file:\/\/\/([^?#]+)/i) || url.match(/^file:\/\/([^?#]+)/i)
  if (!match) return null
  try {
    let path = decodeURIComponent(match[1])
    if (/^\/[a-z]:/i.test(path)) path = path.slice(1)
    path = path.replace(/\//g, '\\')
    return existsSync(path) ? path : null
  } catch {
    return null
  }
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
    const base = browser.rendererBaseUrl()
    if (base) {
      try { void win.loadURL(new URL('controls.html', base).toString()) }
      catch { void win.loadFile(join(__dirname, '../renderer/controls.html')) }
    } else {
      void win.loadFile(join(__dirname, '../renderer/controls.html'))
    }
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
  const sendToolbar = (channel: string, payload?: unknown) => {
    const wc = browser.toolbarWebContents()
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
  // Physical keyboard events can land in a focused child WebContentsView
  // instead of the shell renderer. While the address bar is being edited,
  // intercept them on the page and forward to the shell input.
  let urlInputFocused = false
  let lastForwardedAt = 0
  const handleBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (!urlInputFocused || input.type !== 'keyDown') return
    const key = input.key
    if (!key) return
    // The same key can surface on both the host webContents and a child view.
    if (Date.now() - lastForwardedAt < 30) return
    lastForwardedAt = Date.now()
    event.preventDefault()
    if (key === 'Enter') sendToolbar('input:enter')
    else if (key === 'Backspace' || key === 'Delete' || key.startsWith('Arrow')) sendToolbar('input:key', key)
    else if (key.length === 1 && !input.control && !input.meta && !input.alt) sendToolbar('input:text', key)
  }
  browser.onBeforeInput = handleBeforeInput
  browser.window.webContents.on('before-input-event', handleBeforeInput)
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
    browser.broadcast('tabs:change', { tabs, activeId, hasPage })
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
  let dragOrigin: { x: number; y: number } | null = null
  let dragWindowOrigin: { x: number; y: number } | null = null
  ipcMain.handle('win:dragStart', async () => {
    dragOrigin = screen.getCursorScreenPoint()
    const bounds = browser.window.getBounds()
    dragWindowOrigin = { x: bounds.x, y: bounds.y }
  })
  ipcMain.handle('win:dragMove', async () => {
    if (!dragOrigin || !dragWindowOrigin) return
    const now = screen.getCursorScreenPoint()
    browser.window.setPosition(
      dragWindowOrigin.x + now.x - dragOrigin.x,
      dragWindowOrigin.y + now.y - dragOrigin.y
    )
  })
  ipcMain.handle('win:dragEnd', async () => { dragOrigin = null; dragWindowOrigin = null })
  ipcMain.handle('sidebar:width', async (_e, width: number) => browser.setLeftPanelWidth(width))
  ipcMain.handle('shell:focus', async () => browser.focusToolbar())
  ipcMain.handle('toolbar:focus', async () => browser.focusToolbar())
  ipcMain.handle('sidebar:focus', async () => browser.focusSidebar())
  ipcMain.handle('input:urlFocused', async (_e, focused: boolean) => { urlInputFocused = focused })

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
  let dirWatcher: ReturnType<typeof watch> | null = null
  let dirWatchTimer: NodeJS.Timeout | null = null
  ipcMain.handle('fs:watch', async (_e, dir: string) => {
    dirWatcher?.close()
    dirWatcher = null
    if (dirWatchTimer) { clearTimeout(dirWatchTimer); dirWatchTimer = null }
    if (!dir || !existsSync(dir)) return
    try {
      dirWatcher = watch(dir, { persistent: false }, () => {
        if (dirWatchTimer) clearTimeout(dirWatchTimer)
        dirWatchTimer = setTimeout(() => browser.broadcast('fs:changed', dir), 120)
      })
    } catch { /* directory cannot be watched */ }
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
  // Read only the leading bytes so classification never loads a whole file.
  async function fileHeader(path: string, length = 1024): Promise<Uint8Array> {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      return new Uint8Array(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }
  ipcMain.handle('fs:stat', async (_e, p: string) => {
    try {
      const s = await stat(p)
      let kind: FileKind = 'other'
      if (!s.isDirectory()) {
        try {
          kind = kindByMagic(await fileHeader(p)) ?? kindByExtension(p)
        } catch {
          kind = kindByExtension(p)
        }
      }
      return { size: s.size, mtime: s.mtimeMs, isDirectory: s.isDirectory(), kind }
    } catch {
      return null
    }
  })
  ipcMain.handle('fs:readImage', async (_e, p: string) => {
    const s = await stat(p)
    if (s.size > 20 * 1024 * 1024) throw new Error('图片过大，无法预览')
    const buffer = await readFile(p)
    return `data:${mimeForImage(buffer, p)};base64,${buffer.toString('base64')}`
  })
  ipcMain.handle('fs:readFile', async (_e, p: string) => {
    const s = await stat(p)
    if (s.size > 2 * 1024 * 1024) throw new Error('文件过大，无法预览内容')
    const buffer = await readFile(p)
    // BOM first, then strict UTF-8, with GB18030 fallback for Chinese Windows text files.
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2))
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2))
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return new TextDecoder('utf-8').decode(buffer.subarray(3))
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
    catch { return new TextDecoder('gb18030').decode(buffer) }
  })
  ipcMain.handle('files:openExternal', async (_e, p: string) => shell.openPath(p))
  let lastFilePath = ''
  let lastPreviewPath = ''
  const openUrl = async (url: string): Promise<void> => {
    const localPath = localFileFromUrl(url)
    if (localPath) {
      lastPreviewPath = localPath
      await browser.load(`viewer://preview/${encodeURIComponent(localPath)}`)
      return
    }
    await browser.load(url)
  }
  let fileClipboard: { path: string; mode: 'copy' | 'cut' } | null = null
  ipcMain.handle('clipboard:setFileOp', async (_e, op: { path: string; mode: 'copy' | 'cut' } | null) => {
    fileClipboard = op
  })
  ipcMain.handle('clipboard:getFileOp', async () => fileClipboard)
  ipcMain.handle('clipboard:writeText', async (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('clipboard:readFiles', async () => {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile', '-STA', '-Command',
        '$list = Get-Clipboard -Format FileDropList; foreach ($f in $list) { $f.ToString() }'
      ], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      return output.split(/\r?\n/).map(line => line.trim()).filter(line => line && existsSync(line))
    } catch {
      return []
    }
  })
  ipcMain.handle('clipboard:writeFiles', async (_e, paths: string[]) => {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        `Set-Clipboard -Path ${paths.map(p => JSON.stringify(p)).join(',')}`
      ], { windowsHide: true, timeout: 5000 })
      return ''
    } catch (error) {
      return String(error)
    }
  })
  ipcMain.handle('files:path', async () => lastFilePath)
  ipcMain.handle('files:openTerminal', async (_e, dir: string) => {
    if (!existsSync(dir)) return '目录不存在'
    const options = { cwd: dir, detached: true, stdio: 'ignore' as const, windowsHide: false }
    // Prefer Windows Terminal; fall back to a visible cmd window.
    const wt = spawn('wt.exe', ['-d', dir], options)
    wt.once('error', () => {
      const fallback = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${dir}"`], options)
      fallback.unref()
    })
    wt.unref()
    return ''
  })
  ipcMain.handle('preview:path', async () => lastPreviewPath)
  ipcMain.handle('preview:open', async (_e, path: string) => {
    lastPreviewPath = path
    browser.openInternalTab(`viewer://preview/${encodeURIComponent(path)}`)
  })
  ipcMain.handle('fs:createDir', async (_e, parent: string, name: string) => {
    const target = join(parent, name)
    mkdirSync(target)
    return target
  })
  ipcMain.handle('fs:createFile', async (_e, parent: string, name: string) => {
    const target = join(parent, name)
    writeFileSync(target, '', { flag: 'wx' })
    return target
  })
  ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
    renameSync(from, to)
    return to
  })
  ipcMain.handle('fs:delete', async (_e, path: string) => {
    if (statSync(path).isDirectory()) rmSync(path, { recursive: true, force: true })
    else unlinkSync(path)
  })
  ipcMain.handle('fs:copy', async (_e, from: string, to: string) => { cpSync(from, to, { recursive: true }); return to })
  ipcMain.handle('fs:move', async (_e, from: string, to: string) => { renameSync(from, to); return to })
  ipcMain.handle('files:navigate', async (e, path: string) => {
    lastFilePath = path
    browser.navigateFiles(e.sender.id, path)
  })
  ipcMain.handle('files:home', async () => homedir())
  ipcMain.handle('fs:driveInfo', async () => {
    const result: { path: string; total: number; free: number }[] = []
    for (let code = 65; code <= 90; code++) {
      const root = String.fromCharCode(code) + ':\\'
      if (!existsSync(root)) continue
      try {
        const info = statfsSync(root)
        result.push({ path: root, total: info.blocks * Number(info.bsize), free: info.bavail * Number(info.bsize) })
      } catch {
        result.push({ path: root, total: 0, free: 0 })
      }
    }
    return result
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
    if (url.startsWith('viewer://files/')) {
      try { lastFilePath = decodeURIComponent(url.slice('viewer://files/'.length)) } catch { /* ignore */ }
    } else if (url.startsWith('viewer://preview/')) {
      try { lastPreviewPath = decodeURIComponent(url.slice('viewer://preview/'.length)) } catch { /* ignore */ }
    } else if (url.startsWith('file://')) {
      const localPath = localFileFromUrl(url)
      if (localPath) {
        lastPreviewPath = localPath
        const target = `viewer://preview/${encodeURIComponent(localPath)}`
        await browser.load(target)
        browser.updateActiveFileUrl(target)
        return
      }
    }
    if (url) await browser.load(url)
    if (url.startsWith('viewer://files') || url.startsWith('viewer://preview')) browser.updateActiveFileUrl(url)
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
  ipcMain.handle('bookmark:open', async (_e, url: string) => openUrl(url))

  // browsing history
  ipcMain.handle('history:list', async () => history.list())
  ipcMain.handle('history:remove', async (_e, id: string) => history.remove(id))
  ipcMain.handle('history:clear', async () => history.clear())
  ipcMain.handle('history:open', async (_e, url: string) => openUrl(url))

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
    const url = normalizeInput(initialUrl)
    log('loading initial URL: ' + initialUrl + ' -> ' + url)
    for (const [prefix, assign] of [
      ['viewer://files/', (p: string) => { lastFilePath = p }],
      ['viewer://preview/', (p: string) => { lastPreviewPath = p }]
    ] as const) {
      if (url.startsWith(prefix)) {
        try { assign(decodeURIComponent(url.slice(prefix.length))) } catch { /* ignore */ }
      }
    }
    void browser.load(url).catch(err => log('initial URL FAILED: ' + String(err)))
  }

  // electron-vite sets ELECTRON_RENDERER_URL with the actual port (5173/5174...).
  // Allow explicit override via AI_BROWSER_RENDERER_URL / VITE_PORT.
  const rendererUrl = process.env.AI_BROWSER_RENDERER_URL
    || process.env.ELECTRON_RENDERER_URL
    || `http://localhost:${process.env.VITE_PORT || '5173'}`
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('renderer load timeout')), ms))
    ])
  const loadShell = async (): Promise<boolean> => {
    try {
      await withTimeout(browser.window.loadURL(rendererUrl), 4000)
      return true
    } catch (error) {
      log(`renderer URL failed (${rendererUrl}): ${String(error)}, falling back to built files`)
      await browser.window.loadFile(join(__dirname, '../renderer/index.html'))
      return false
    }
  }
  void loadShell().then(fromUrl => {
    log('renderer loaded from ' + (fromUrl ? 'dev server' : 'built files'))
    browser.setRendererBase(fromUrl ? rendererUrl : null)
    if (fromUrl) browser.reloadInternalTabs()
    browser.sendPageToBack()
    const built = (name: string) => join(__dirname, '../renderer', name)
    const fromBase = (name: string): string => {
      try { return new URL(name, rendererUrl).toString() }
      catch { return rendererUrl.replace(/\/?$/, '/' + name) }
    }
    if (fromUrl) {
      void withTimeout(browser.loadToolbar(fromBase('toolbar.html')), 4000).catch(() => browser.loadToolbarFile(built('toolbar.html')))
      void withTimeout(browser.loadSidebar(fromBase('sidebar.html')), 4000).catch(() => browser.loadSidebarFile(built('sidebar.html')))
    } else {
      void browser.loadToolbarFile(built('toolbar.html'))
      void browser.loadSidebarFile(built('sidebar.html'))
    }
  }).catch(err => log('renderer load FAILED: ' + String(err)))

  browser.window.webContents.on('did-finish-load', () => browser.sendPageToBack())

  browser.window.on('focus', () => {
    // The independent controls window can keep Electron's internal focus even
    // after Windows switches foreground to us. Reclaim it here.
    browser.window.webContents.focus()
  })
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
