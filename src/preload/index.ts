import { contextBridge, ipcRenderer } from 'electron'
import type { Point } from '@shared/types'
import type { TabInfo } from '../main/browser'
import type { ResourceRecord } from '../main/resource-monitor'
import type { Bookmark } from '../main/bookmarks'
import type { HistoryEntry } from '../main/history'
import type { DownloadRecord } from '../main/downloads'
import type { InspectedElement } from '../main/dialog-bridge'
import type { FileKind } from '../shared/file-types'

export interface BrowserAPI {
  winMinimize(): Promise<void>
  winMaximize(): Promise<void>
  winClose(): Promise<void>
  winIsMaximized(): Promise<boolean>

  tabNew(): Promise<number>
  tabClose(id: number): Promise<void>
  tabActivate(id: number): Promise<void>
  tabList(): Promise<TabInfo[]>
  tabHasPage(): Promise<boolean>

  browserLoad(input: string): Promise<void>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>
  browserHome(): Promise<void>

  screenshotBegin(): Promise<void>
  screenshotEnd(): Promise<void>
  onScreenshotBegin(cb: () => void): void
  onScreenshotEnd(cb: () => void): void
  screenshotCapture(options?: {
    rect?: { x: number; y: number; width: number; height: number }
    fullPage?: boolean
  }): Promise<{ path: string; dataUrl: string }>
  screenshotCopy(dataUrl: string): Promise<void>
  screenshotOpen(path: string): Promise<string>
  screenshotReveal(path: string): Promise<void>

  bookmarkList(): Promise<Bookmark[]>
  bookmarkToggle(): Promise<{ bookmarked: boolean; bookmarks: Bookmark[] }>
  bookmarkRemove(id: string): Promise<Bookmark[]>
  bookmarkClear(): Promise<void>
  bookmarkOpen(url: string): Promise<void>

  historyList(): Promise<HistoryEntry[]>
  historyRemove(id: string): Promise<void>
  historyClear(): Promise<void>
  historyOpen(url: string): Promise<void>

  downloadsList(): Promise<DownloadRecord[]>
  downloadsCancel(id: string): Promise<void>
  downloadsOpen(id: string): Promise<string | undefined>
  downloadsReveal(id: string): Promise<void>
  downloadsRemove(id: string): Promise<void>
  downloadsClearCompleted(): Promise<void>
  downloadsOpenFolder(): Promise<string | undefined>
  downloadsResume(id: string): Promise<void>

  elementStartPick(): Promise<boolean>
  elementStopPick(): Promise<void>

  vmMove(x: number, y: number, space: 'page' | 'screen'): Promise<void>
  vmClick(button?: 'left' | 'right', clickCount?: number): Promise<void>
  vmMoveClick(x: number, y: number, space: 'page' | 'screen', button?: 'left' | 'right', clickCount?: number): Promise<void>
  vmNudge(dx: number, dy: number): Promise<void>
  vmScroll(deltaX: number, deltaY: number): Promise<void>
  kbType(text: string): Promise<void>
  kbPress(key: string): Promise<void>

  onControlsState(cb: (open: boolean) => void): void
  onResourcesUpdate(cb: (records: ResourceRecord[]) => void): void
  resourcesList(): Promise<ResourceRecord[]>
  resourcesClear(): Promise<void>
  resourcesClearAll(): Promise<void>

  controlsShow(): Promise<void>
  controlsToggle(): Promise<void>
  controlsIsOpen(): Promise<boolean>
  winPin(pinned: boolean): Promise<void>
  winIsPinned(): Promise<boolean>
  winDragStart(): Promise<void>
  winDragMove(): Promise<void>
  winDragEnd(): Promise<void>
  sidebarWidth(width: number): Promise<void>
  shellFocus(): Promise<void>
  toolbarFocus(): Promise<void>
  sidebarFocus(): Promise<void>
  setUrlInputFocused(focused: boolean): Promise<void>

  onInputText(cb: (text: string) => void): void
  onInputKey(cb: (key: string) => void): void
  onInputEnter(cb: () => void): void
  settingsOpen(): Promise<number>
  internalOpen(url: string): Promise<number>
  settingsState(): Promise<any>
  settingsAction(action: string, value: boolean | string): Promise<string>
  settingsPickFolder(): Promise<string>
  onSettingsChanged(cb: (state: any) => void): void
  controlsMinimize(): Promise<void>
  controlsClose(): Promise<void>
  controlsPin(pinned: boolean): Promise<void>
  controlsIsPinned(): Promise<boolean>
  vmPosition(): Promise<Point>
  vmVisible(visible: boolean): Promise<void>
  vmCenter(): Promise<void>

  onTabsChange(cb: (state: { tabs: TabInfo[]; activeId: number | null; hasPage: boolean }) => void): void
  onCursorMove(cb: (point: Point) => void): void
  onCursorVisible(cb: (visible: boolean) => void): void
  onDownloadsUpdate(cb: (items: DownloadRecord[]) => void): void
  onHistoryUpdate(cb: (items: HistoryEntry[]) => void): void
  onBookmarksUpdate(cb: (items: Bookmark[]) => void): void
  onElementPicked(cb: (element: InspectedElement) => void): void
  onElementMode(cb: (active: boolean) => void): void

  onFileChooser(cb: (req: { id: number; mode: string; backendNodeId: number; accept: string[]; directory: boolean; multiple: boolean }) => void): void
  onFileChooserClose(cb: () => void): void
  fileChooserRespond(backendNodeId: number, files: string[]): Promise<void>
  fsList(dir: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>
  fsDrives(): Promise<string[]>
  fsDriveInfo(): Promise<{ path: string; total: number; free: number }[]>
  fsBasename(path: string): Promise<string>
  fsWatch(dir: string): Promise<void>
  onFsChanged(cb: (dir: string) => void): void
  fsReadImage(path: string): Promise<string>
  fsStat(path: string): Promise<{ size: number; mtime: number; isDirectory: boolean; kind: FileKind } | null>
  fsReadFile(path: string): Promise<string>
  filesOpenExternal(path: string): Promise<string>
  clipboardSetFileOp(op: { path: string; mode: 'copy' | 'cut' } | null): Promise<void>
  clipboardGetFileOp(): Promise<{ path: string; mode: 'copy' | 'cut' } | null>
  clipboardWriteText(text: string): Promise<void>
  clipboardWriteFiles(paths: string[]): Promise<string>
  clipboardReadFiles(): Promise<string[]>
  filesPath(): Promise<string>
  filesOpenTerminal(dir: string): Promise<string>
  filesNavigate(path: string): Promise<void>
  filesHome(): Promise<string>
  fsCreateDir(parent: string, name: string): Promise<string>
  fsCreateFile(parent: string, name: string): Promise<string>
  fsRename(from: string, to: string): Promise<string>
  fsDelete(path: string): Promise<void>
  fsCopy(from: string, to: string): Promise<string>
  fsMove(from: string, to: string): Promise<string>
  previewOpen(path: string): Promise<void>
  previewPath(): Promise<string>
}

const api: BrowserAPI = {
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),

  tabNew: () => ipcRenderer.invoke('tab:new'),
  tabClose: id => ipcRenderer.invoke('tab:close', id),
  tabActivate: id => ipcRenderer.invoke('tab:activate', id),
  tabList: () => ipcRenderer.invoke('tab:list'),
  tabHasPage: () => ipcRenderer.invoke('tab:hasPage'),

  browserLoad: input => ipcRenderer.invoke('browser:load', input),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserHome: () => ipcRenderer.invoke('browser:home'),

  screenshotBegin: () => ipcRenderer.invoke('screenshot:begin'),
  screenshotEnd: () => ipcRenderer.invoke('screenshot:end'),
  onScreenshotBegin: cb => ipcRenderer.on('screenshot:begin', () => cb()),
  onScreenshotEnd: cb => ipcRenderer.on('screenshot:end', () => cb()),
  screenshotCapture: options => ipcRenderer.invoke('screenshot:capture', options),
  screenshotCopy: dataUrl => ipcRenderer.invoke('screenshot:copy', dataUrl),
  screenshotOpen: path => ipcRenderer.invoke('screenshot:open', path),
  screenshotReveal: path => ipcRenderer.invoke('screenshot:reveal', path),

  bookmarkList: () => ipcRenderer.invoke('bookmark:list'),
  bookmarkToggle: () => ipcRenderer.invoke('bookmark:toggle'),
  bookmarkRemove: id => ipcRenderer.invoke('bookmark:remove', id),
  bookmarkClear: () => ipcRenderer.invoke('bookmark:clear'),
  bookmarkOpen: url => ipcRenderer.invoke('bookmark:open', url),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyRemove: id => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyOpen: url => ipcRenderer.invoke('history:open', url),

  downloadsList: () => ipcRenderer.invoke('downloads:list'),
  downloadsCancel: id => ipcRenderer.invoke('downloads:cancel', id),
  downloadsOpen: id => ipcRenderer.invoke('downloads:open', id),
  downloadsReveal: id => ipcRenderer.invoke('downloads:reveal', id),
  downloadsRemove: id => ipcRenderer.invoke('downloads:remove', id),
  downloadsClearCompleted: () => ipcRenderer.invoke('downloads:clearCompleted'),
  downloadsOpenFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  downloadsResume: id => ipcRenderer.invoke('downloads:resume', id),

  elementStartPick: () => ipcRenderer.invoke('element:startPick'),
  elementStopPick: () => ipcRenderer.invoke('element:stopPick'),

  vmMove: (x, y, space) => ipcRenderer.invoke('vm:move', x, y, space),
  vmClick: (button, clickCount) => ipcRenderer.invoke('vm:click', button, clickCount),
  vmMoveClick: (x, y, space, button, clickCount) => ipcRenderer.invoke('vm:moveClick', x, y, space, button, clickCount),
  vmNudge: (dx, dy) => ipcRenderer.invoke('vm:nudge', dx, dy),
  vmScroll: (deltaX, deltaY) => ipcRenderer.invoke('vm:scroll', deltaX, deltaY),
  kbType: text => ipcRenderer.invoke('kb:type', text),
  kbPress: key => ipcRenderer.invoke('kb:press', key),
  vmPosition: () => ipcRenderer.invoke('vm:position'),
  vmVisible: visible => ipcRenderer.invoke('vm:visible', visible),
  vmCenter: () => ipcRenderer.invoke('vm:center'),

  onTabsChange: cb => ipcRenderer.on('tabs:change', (_e, state) => cb(state)),
  onCursorMove: cb => ipcRenderer.on('cursor:move', (_e, point) => cb(point)),
  onCursorVisible: cb => ipcRenderer.on('cursor:visible', (_e, visible) => cb(visible)),
  onDownloadsUpdate: cb => ipcRenderer.on('downloads:update', (_e, items) => cb(items)),
  onHistoryUpdate: cb => ipcRenderer.on('history:update', (_e, items) => cb(items)),
  onBookmarksUpdate: cb => ipcRenderer.on('bookmarks:update', (_e, items) => cb(items)),
  onElementPicked: cb => ipcRenderer.on('element:picked', (_e, element) => cb(element)),
  onElementMode: cb => ipcRenderer.on('element:mode', (_e, active) => cb(active)),

  onFileChooser: cb => ipcRenderer.on('filechooser:open', (_e, req) => cb(req)),
  onFileChooserClose: cb => ipcRenderer.on('filechooser:close', () => cb()),
  fileChooserRespond: (backendNodeId, files) => ipcRenderer.invoke('filechooser:respond', backendNodeId, files),
  fsList: dir => ipcRenderer.invoke('fs:list', dir),
  fsDrives: () => ipcRenderer.invoke('fs:drives'),
  fsDriveInfo: () => ipcRenderer.invoke('fs:driveInfo'),
  fsBasename: path => ipcRenderer.invoke('fs:basename', path),
  fsWatch: dir => ipcRenderer.invoke('fs:watch', dir),
  onFsChanged: cb => ipcRenderer.on('fs:changed', (_e, dir) => cb(dir)),
  fsReadImage: path => ipcRenderer.invoke('fs:readImage', path),
  fsStat: path => ipcRenderer.invoke('fs:stat', path),
  fsReadFile: path => ipcRenderer.invoke('fs:readFile', path),
  filesOpenExternal: path => ipcRenderer.invoke('files:openExternal', path),
  clipboardSetFileOp: op => ipcRenderer.invoke('clipboard:setFileOp', op),
  clipboardGetFileOp: () => ipcRenderer.invoke('clipboard:getFileOp'),
  clipboardWriteText: text => ipcRenderer.invoke('clipboard:writeText', text),
  clipboardWriteFiles: paths => ipcRenderer.invoke('clipboard:writeFiles', paths),
  clipboardReadFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
  filesPath: () => ipcRenderer.invoke('files:path'),
  filesOpenTerminal: dir => ipcRenderer.invoke('files:openTerminal', dir),
  filesNavigate: path => ipcRenderer.invoke('files:navigate', path),
  filesHome: () => ipcRenderer.invoke('files:home'),
  fsCreateDir: (parent, name) => ipcRenderer.invoke('fs:createDir', parent, name),
  fsCreateFile: (parent, name) => ipcRenderer.invoke('fs:createFile', parent, name),
  fsRename: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  fsDelete: path => ipcRenderer.invoke('fs:delete', path),
  fsCopy: (from, to) => ipcRenderer.invoke('fs:copy', from, to),
  fsMove: (from, to) => ipcRenderer.invoke('fs:move', from, to),
  previewOpen: path => ipcRenderer.invoke('preview:open', path),
  previewPath: () => ipcRenderer.invoke('preview:path'),

  onControlsState: cb => ipcRenderer.on('controls:state', (_e, open) => cb(open)),
  onResourcesUpdate: cb => ipcRenderer.on('resources:update', (_e, records) => cb(records)),
  resourcesList: () => ipcRenderer.invoke('resources:list'),
  resourcesClear: () => ipcRenderer.invoke('resources:clear'),
  resourcesClearAll: () => ipcRenderer.invoke('resources:clearAll'),

  controlsShow: () => ipcRenderer.invoke('controls:show'),
  controlsToggle: () => ipcRenderer.invoke('controls:toggle'),
  controlsIsOpen: () => ipcRenderer.invoke('controls:isOpen'),
  winPin: pinned => ipcRenderer.invoke('win:pin', pinned),
  winIsPinned: () => ipcRenderer.invoke('win:isPinned'),
  winDragStart: () => ipcRenderer.invoke('win:dragStart'),
  winDragMove: () => ipcRenderer.invoke('win:dragMove'),
  winDragEnd: () => ipcRenderer.invoke('win:dragEnd'),
  sidebarWidth: width => ipcRenderer.invoke('sidebar:width', width),
  shellFocus: () => ipcRenderer.invoke('shell:focus'),
  toolbarFocus: () => ipcRenderer.invoke('toolbar:focus'),
  sidebarFocus: () => ipcRenderer.invoke('sidebar:focus'),
  setUrlInputFocused: focused => ipcRenderer.invoke('input:urlFocused', focused),

  onInputText: cb => ipcRenderer.on('input:text', (_e, text) => cb(text)),
  onInputKey: cb => ipcRenderer.on('input:key', (_e, key) => cb(key)),
  onInputEnter: cb => ipcRenderer.on('input:enter', () => cb()),
  settingsOpen: () => ipcRenderer.invoke('settings:open'),
  internalOpen: url => ipcRenderer.invoke('internal:open', url),
  settingsState: () => ipcRenderer.invoke('settings:state'),
  settingsAction: (action, value) => ipcRenderer.invoke('settings:action', action, value),
  settingsPickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
  onSettingsChanged: cb => ipcRenderer.on('settings:changed', (_e, state) => cb(state)),
  controlsMinimize: () => ipcRenderer.invoke('controls:minimize'),
  controlsClose: () => ipcRenderer.invoke('controls:close'),
  controlsPin: pinned => ipcRenderer.invoke('controls:pin', pinned),
  controlsIsPinned: () => ipcRenderer.invoke('controls:isPinned')
}

// Only Viewer's own internal pages may access the local IPC surface.
// Normal web pages never receive preload; if a privileged tab later navigates
// to an external URL, preload reruns there and this guard blocks the API.
const internalPage = (() => {
  try {
    const { protocol, pathname, hostname } = window.location
    // The cursor/file-picker overlay is a data: page containing our cursor DOM.
    if (protocol === 'data:' && window.location.href.includes('cursor%7Bposition%3Aabsolute')) return true
    // Dev server (electron-vite) and built file: pages are both internal.
    if (protocol === 'http:' && /^localhost$|^127\.0\.0\.1$/.test(hostname)) {
      return /\/(index|controls|settings|home|bookmarks|history|downloads|toolbar|sidebar|newtab|files|preview)\.html$/.test(pathname) || pathname === '/'
    }
    return protocol === 'file:' && /\/(index|controls|settings|home|bookmarks|history|downloads|toolbar|sidebar|newtab|files|preview)\.html$/i.test(pathname)
  } catch {
    return false
  }
})()

if (internalPage) {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', api)
  } else {
    (window as unknown as { api: BrowserAPI }).api = api
  }
}
