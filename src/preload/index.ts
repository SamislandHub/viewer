import { contextBridge, ipcRenderer } from 'electron'
import type { Point } from '@shared/types'
import type { TabInfo } from '../main/browser'
import type { ResourceRecord } from '../main/resource-monitor'

export interface BrowserAPI {
  winMinimize(): Promise<void>
  winMaximize(): Promise<void>
  winClose(): Promise<void>
  winIsMaximized(): Promise<boolean>

  tabNew(): Promise<number>
  tabClose(id: number): Promise<void>
  tabActivate(id: number): Promise<void>
  tabList(): Promise<TabInfo[]>

  browserLoad(input: string): Promise<void>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>

  vmMove(x: number, y: number, space: 'page' | 'screen'): Promise<void>
  vmClick(button?: 'left' | 'right', clickCount?: number): Promise<void>
  vmMoveClick(x: number, y: number, space: 'page' | 'screen', button?: 'left' | 'right', clickCount?: number): Promise<void>
  vmNudge(dx: number, dy: number): Promise<void>
  vmScroll(deltaX: number, deltaY: number): Promise<void>
  kbType(text: string): Promise<void>
  kbPress(key: string): Promise<void>

  onResourcesUpdate(cb: (records: ResourceRecord[]) => void): void
  resourcesList(): Promise<ResourceRecord[]>
  resourcesClear(): Promise<void>
  resourcesClearAll(): Promise<void>
  vmPosition(): Promise<Point>
  vmVisible(visible: boolean): Promise<void>
  vmCenter(): Promise<void>

  onTabsChange(cb: (state: { tabs: TabInfo[]; activeId: number | null }) => void): void
  onCursorMove(cb: (point: Point) => void): void
  onCursorVisible(cb: (visible: boolean) => void): void

  onFileChooser(cb: (req: { id: number; mode: string; backendNodeId: number; accept: string[]; directory: boolean; multiple: boolean }) => void): void
  onFileChooserClose(cb: () => void): void
  fileChooserRespond(backendNodeId: number, files: string[]): Promise<void>
  fsList(dir: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>
  fsDrives(): Promise<string[]>
  fsBasename(path: string): Promise<string>
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

  browserLoad: input => ipcRenderer.invoke('browser:load', input),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),

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

  onFileChooser: cb => ipcRenderer.on('filechooser:open', (_e, req) => cb(req)),
  onFileChooserClose: cb => ipcRenderer.on('filechooser:close', () => cb()),
  fileChooserRespond: (backendNodeId, files) => ipcRenderer.invoke('filechooser:respond', backendNodeId, files),
  fsList: dir => ipcRenderer.invoke('fs:list', dir),
  fsDrives: () => ipcRenderer.invoke('fs:drives'),
  fsBasename: path => ipcRenderer.invoke('fs:basename', path),

  onResourcesUpdate: cb => ipcRenderer.on('resources:update', (_e, records) => cb(records)),
  resourcesList: () => ipcRenderer.invoke('resources:list'),
  resourcesClear: () => ipcRenderer.invoke('resources:clear'),
  resourcesClearAll: () => ipcRenderer.invoke('resources:clearAll')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  (window as unknown as { api: BrowserAPI }).api = api
}
