import { kindByExtension, resolveKind, type FileKind } from '../../shared/file-types'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const content = $<HTMLElement>('content')
const modal = $<HTMLElement>('modal')
const modalTitle = $<HTMLElement>('modalTitle')
const modalInput = $<HTMLInputElement>('modalInput')
const QUICK = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos']
const QUICK_NAMES: Record<string, string> = {
  Desktop: '桌面', Downloads: 'Downloads', Documents: '文档',
  Pictures: '图片', Music: '音乐', Videos: '视频'
}
const DRIVE_ICON = `<svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="#4c8bf5" d="M802.27 226.4c-11.11-36.78-46.65-60.59-84.42-60.59H306.14c-37.77 0-73.31 23.8-84.41 60.59L64 533.63h896L802.27 226.4z" />
  <path fill="#ffffff" d="M692.33 366.02H356.64c-10.69 0-19.35-8.44-19.35-18.84 0-10.41 8.67-18.85 19.35-18.85h335.69c10.69 0 19.35 8.44 19.35 18.85 0 10.4-8.67 18.84-19.35 18.84z" />
  <path fill="#adb5bd" d="M64 805.86c0 28.78 24.17 52.32 53.71 52.32h788.57c29.54 0 53.72-23.54 53.72-52.32V598.55H64v207.31z" />
  <path fill="#2f9e44" d="M682.31 706.73h111.07c17.77 0 33.32 15.14 33.32 32.45 0 17.31-15.55 32.46-33.32 32.46H682.31c-17.77 0-33.32-15.15-33.32-32.46 0-17.31 15.55-32.45 33.32-32.45z" />
</svg>`

const QUICK_ICONS: Record<string, string> = {
  Desktop: '🖥️', Downloads: '⬇️', Documents: '📄',
  Pictures: '🖼️', Music: '🎵', Videos: '🎬'
}

let activePath = new URLSearchParams(location.search).get('path') ?? ''
let home = ''
let selectedPath = ''
let clipboard: { path: string; mode: 'copy' | 'cut' } | null = null
let menuTargetPath = ''
let systemClipboardHasFiles = false

interface RecentEntry { path: string; time: number }
interface QuickFolder { name: string; path: string; icon?: string }

function extraQuick(): QuickFolder[] {
  try { return JSON.parse(localStorage.getItem('viewerFilesQuick') || '[]') as QuickFolder[] }
  catch { return [] }
}
function quickFolders(): QuickFolder[] {
  return [
    ...QUICK.map(dir => ({ name: QUICK_NAMES[dir], path: joinPath(home, dir), icon: QUICK_ICONS[dir] })),
    ...extraQuick().filter(item => item?.path)
  ]
}
function addQuickFolder(path: string): void {
  if (quickFolders().some(item => item.path.toLowerCase() === path.toLowerCase())) return
  const extra = extraQuick()
  extra.push({ name: baseName(path), path })
  localStorage.setItem('viewerFilesQuick', JSON.stringify(extra))
}

function recent(): RecentEntry[] {
  try { return (JSON.parse(localStorage.getItem('viewerFilesRecent') || '[]') as RecentEntry[]).filter(e => e?.path) }
  catch { return [] }
}
function remember(path: string): void {
  const list = recent().filter(e => e.path !== path)
  list.unshift({ path, time: Date.now() })
  localStorage.setItem('viewerFilesRecent', JSON.stringify(list.slice(0, 20)))
}
function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}
function parentOf(path: string): string {
  const value = path.replace(/\//g, '\\').replace(/\\+$/, '')
  const i = value.lastIndexOf('\\')
  return i > 0 ? value.slice(0, i) : ''
}
function joinPath(...parts: string[]): string { return parts.join('\\').replace(/\/+/g, '\\') }
async function existsLike(path: string): Promise<boolean> {
  try { return (await window.api.fsStat(path)) !== null } catch { return false }
}

function navigate(path: string): void {
  if (path) remember(path)
  selectedPath = ''
  void window.api.filesNavigate(path)
}
function openEntry(path: string, isDir: boolean): void {
  if (isDir) navigate(path)
  else void window.api.previewOpen(path)
}
function iconFor(name: string, isDir: boolean, detected?: FileKind): string {
  if (isDir) return '📁'
  const kind = detected ?? kindByExtension(name)
  if (kind === 'image') return '🖼️'
  if (kind === 'html') return '🌐'
  if (kind === 'text') return '📄'
  if (/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(name)) return '🎵'
  if (/\.(mp4|mkv|avi|mov|webm|wmv)$/i.test(name)) return '🎬'
  if (/\.(pdf)$/i.test(name)) return '📕'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return '📦'
  return '📄'
}
function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${i <= 1 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

function formatTime(time: number): string {
  if (!time) return ''
  return new Date(time).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).replace(/\//g, '-')
}

function friendlyError(error: unknown): string {
  const text = String(error)
  if (text.includes('EPERM') || text.includes('EACCES')) {
    return '没有权限写入该目录：当前 Electron 进程完整性级别过低。'
  }
  return text
}

function confirmAction(message: string): Promise<boolean> {
  modal.hidden = false
  modalTitle.textContent = message
  modalInput.hidden = true
  return new Promise(resolve => {
    const ok = $<HTMLButtonElement>('modalOk')
    const cancel = $<HTMLButtonElement>('modalCancel')
    const close = (result: boolean) => { modal.hidden = true; ok.onclick = null; cancel.onclick = null; resolve(result) }
    ok.onclick = () => close(true)
    cancel.onclick = () => close(false)
  })
}

function on(id: string, type: string, cb: () => void): void {
  document.addEventListener(type, event => {
    if ((event.target as HTMLElement)?.closest(`#${id}`)) cb()
  })
}

function inlineCreate(kind: 'dir' | 'file', defaultName: string, dir = activePath || home): void {
  const row = document.createElement('div')
  row.className = 'item editing'
  const icon = document.createElement('span')
  icon.className = 'ico'
  icon.textContent = kind === 'dir' ? '📁' : '📄'
  const input = document.createElement('input')
  input.className = 'name-input'
  input.value = defaultName
  row.append(icon, input)
  const table = content.querySelector<HTMLElement>('.table')
  if (table) table.prepend(row)
  else content.prepend(row)
  input.focus()
  input.select()
  let done = false
  const finish = async (commit: boolean): Promise<void> => {
    if (done) return
    done = true
    const name = input.value.trim()
    if (!commit || !name) { await render(); return }
    try {
      if (kind === 'dir') await window.api.fsCreateDir(dir, name)
      else await window.api.fsCreateFile(dir, name)
      await render()
    } catch (error) {
      await confirmAction('创建失败：' + friendlyError(error))
      await render()
    }
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true) }
    else if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  })
  input.addEventListener('blur', () => void finish(true))
}

function inlineRename(path: string, oldName: string): void {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.table tr[data-path]'))
    .find(item => item.dataset.path === path)
  if (!row) return
  const label = row.querySelector<HTMLElement>('.name-cell span:last-child')
  if (!label) return
  const input = document.createElement('input')
  input.className = 'name-input'
  input.value = oldName
  label.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const finish = async (commit: boolean): Promise<void> => {
    if (done) return
    done = true
    const name = input.value.trim()
    if (!commit || !name || name === oldName) { await render(); return }
    try {
      await window.api.fsRename(path, joinPath(parentOf(path), name))
      selectedPath = ''
      await render()
    } catch (error) {
      await confirmAction('重命名失败：' + friendlyError(error))
      await render()
    }
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true) }
    else if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  })
  input.addEventListener('blur', () => void finish(true))
}

function updateActions(): void {
  const noCreate = !activePath
  for (const id of ['rename', 'delete', 'cut', 'copy']) {
    $<HTMLButtonElement>(id).disabled = !selectedPath
  }
  const createButtons: HTMLButtonElement[] = [
    $<HTMLButtonElement>('newBtn'),
    ...Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file'))
  ]
  for (const button of createButtons) {
    button.disabled = noCreate
    button.title = noCreate ? '请进入文件夹后再新建' : ''
  }
  $<HTMLButtonElement>('paste').disabled = noCreate
  $<HTMLButtonElement>('up').disabled = !activePath
  $<HTMLButtonElement>('home').disabled = !activePath
}

function goUp(): void {
  if (!activePath) return
  let parent = parentOf(activePath)
  if (/^[a-z]:$/i.test(parent)) parent += '\\'
  navigate(parent)
}

function title(text: string): HTMLElement {
  const h = document.createElement('div')
  h.className = 'section-title'
  h.textContent = text
  return h
}

function addTable(rows: { name: string; path: string; isDir: boolean; time?: number; kind?: FileKind }[]): void {
  if (!rows.length) {
    content.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '此文件夹为空' }))
    return
  }
  const table = document.createElement('table')
  table.className = 'table'
  const head = document.createElement('tr')
  for (const label of ['名称', '访问日期', '活动']) {
    head.append(Object.assign(document.createElement('th'), { textContent: label }))
  }
  table.append(head)
  for (const row of rows) {
    const tr = document.createElement('tr')
    tr.dataset.path = row.path
    tr.dataset.isdir = String(row.isDir)
    if (row.path === selectedPath) tr.style.background = '#e7f1ff'
    const nameTd = document.createElement('td')
    const nameCell = document.createElement('div')
    nameCell.className = 'name-cell'
    nameCell.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: iconFor(row.name, row.isDir, row.kind) }),
      Object.assign(document.createElement('span'), { textContent: row.name })
    )
    nameTd.append(nameCell)
    tr.append(nameTd)
    tr.append(Object.assign(document.createElement('td'), { className: 'date', textContent: row.time ? formatTime(row.time) : '' }))
    tr.append(Object.assign(document.createElement('td'), { className: 'activity' }))
    tr.addEventListener('click', event => {
      selectedPath = row.path
      updateActions()
      table.querySelectorAll('tr').forEach(r => { (r as HTMLElement).style.background = '' })
      tr.style.background = '#e7f1ff'
      // Ctrl/Cmd + click selects without opening, for rename/copy/cut/delete.
      if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) return
      openEntry(row.path, row.isDir)
    })
    table.append(tr)
  }
  content.append(table)
}

async function renderSidebar(): Promise<void> {
  home = await window.api.filesHome()
  const quick = $<HTMLElement>('quickList')
  quick.replaceChildren()
  for (const folder of quickFolders()) {
    const item = document.createElement('div')
    item.className = 'side-item'
    item.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: folder.icon || '📁' }),
      Object.assign(document.createElement('span'), { textContent: folder.name })
    )
    item.dataset.path = folder.path
    item.addEventListener('click', () => navigate(folder.path))
    quick.append(item)
  }
  const drives = $<HTMLElement>('driveList')
  drives.replaceChildren()
  for (const drive of await window.api.fsDriveInfo()) {
    const item = document.createElement('div')
    item.className = 'side-item drive-item'
    const driveIcon = document.createElement('span')
    driveIcon.className = 'drive-ico'
    driveIcon.innerHTML = DRIVE_ICON

    driveIcon.className = 'drive-ico'
    const info = document.createElement('div')
    info.className = 'drive-info'
    const top = document.createElement('div')
    top.className = 'drive-top'
    top.append(Object.assign(document.createElement('b'), { textContent: drive.path }))
    const used = drive.total ? Math.max(0, Math.min(100, (1 - drive.free / drive.total) * 100)) : 0
    const bar = document.createElement('div')
    bar.className = 'drive-bar'
    const fill = document.createElement('span')
    fill.style.width = `${used}%`
    bar.append(fill)
    const text = document.createElement('small')
    text.textContent = drive.total ? `${formatSize(drive.free)} 可用，共 ${formatSize(drive.total)}` : ''
    info.append(top, bar, text)
    item.append(driveIcon, info)
    if (activePath.toUpperCase().startsWith(drive.path.toUpperCase())) item.classList.add('active')
    item.dataset.path = drive.path
    item.addEventListener('click', () => navigate(drive.path))
    drives.append(item)
  }
}

async function renderRoot(): Promise<void> {
  content.append(title('快速访问'))
  const tiles = document.createElement('div')
  tiles.className = 'tiles'
  for (const folder of quickFolders()) {
    const tile = document.createElement('div')
    tile.className = 'tile'
    tile.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: folder.icon || '📁' }),
      (() => {
        const label = document.createElement('div')
        label.className = 'label'
        label.append(
          Object.assign(document.createElement('b'), { textContent: folder.name }),
          Object.assign(document.createElement('small'), { textContent: '本地存储' })
        )
        return label
      })()
    )
    tile.addEventListener('click', () => navigate(folder.path))
    tiles.append(tile)
  }
  content.append(tiles)
  content.append(title('最近访问'))
  const rows: { name: string; path: string; isDir: boolean; time: number; kind?: FileKind }[] = []
  for (const entry of recent()) {
    try {
      const stat = await window.api.fsStat(entry.path)
      if (!stat) continue
      rows.push({
        name: baseName(entry.path), path: entry.path, isDir: stat.isDirectory, time: entry.time,
        kind: stat.isDirectory ? undefined : resolveKind(kindByExtension(entry.path), stat.kind)
      })
    } catch { /* removed */ }
  }
  addTable(rows)
}

async function renderDirectory(path: string): Promise<void> {
  const entries = await window.api.fsList(path)
  const rows = await Promise.all(entries.map(async entry => {
    try {
      const stat = await window.api.fsStat(entry.path)
      return {
        name: entry.name, path: entry.path, isDir: entry.isDirectory, time: stat?.mtime ?? 0,
        kind: stat && !stat.isDirectory ? resolveKind(kindByExtension(entry.path), stat.kind) : kindByExtension(entry.path)
      }
    } catch {
      return { name: entry.name, path: entry.path, isDir: entry.isDirectory, time: 0, kind: kindByExtension(entry.path) }
    }
  }))
  addTable(rows)
}

let rendering = false
let renderPending = false

async function doRender(): Promise<void> {
  content.replaceChildren()
  updateActions()
  try {
    if (!activePath) {
      void window.api.fsWatch('')
      await renderRoot()
    } else {
      const stat = await window.api.fsStat(activePath)
      if (!stat) {
        content.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '路径不存在' }))
        return
      }
      if (stat.isDirectory) {
        void window.api.fsWatch(activePath)
        await renderDirectory(activePath)
      } else {
        void window.api.fsWatch('')
        const box = document.createElement('div')
        box.className = 'preview'
        box.textContent = '此项目是文件，单击列表中的文件可在独立标签页预览。'
        content.append(box)
      }
    }
  } catch (error) {
    content.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: String(error) }))
  }
}

async function render(): Promise<void> {
  if (rendering) { renderPending = true; return }
  rendering = true
  try {
    await doRender()
  } finally {
    rendering = false
    if (renderPending) { renderPending = false; void render() }
  }
}

on('home', 'click', () => void window.api.filesNavigate(''))
on('up', 'click', () => goUp())
const createFolder = (dir = activePath || home): void => inlineCreate('dir', '新建文件夹', dir)
const createFile = (defaultName: string, dir = activePath || home): void => inlineCreate('file', defaultName, dir)
on('newBtn', 'click', createFolder)
const newWrap = document.querySelector<HTMLElement>('.new-wrap')
newWrap?.addEventListener('mouseenter', () => {
  if (!$<HTMLButtonElement>('newBtn').disabled) $<HTMLElement>('newMenu').hidden = false
})
newWrap?.addEventListener('mouseleave', () => { $<HTMLElement>('newMenu').hidden = true })
document.addEventListener('click', event => {
  if (!(event.target as HTMLElement)?.closest('.new-wrap')) $<HTMLElement>('newMenu').hidden = true
})
$('newMenu').addEventListener('click', () => { $<HTMLElement>('newMenu').hidden = true })
const writeSystemClipboard = (path: string): void => { void window.api.clipboardWriteFiles([path]) }
const doCut = (): void => {
  if (!selectedPath) return
  clipboard = { path: selectedPath, mode: 'cut' }
  void window.api.clipboardSetFileOp(clipboard)
  writeSystemClipboard(selectedPath)
  updateActions()
}
const doCopy = (): void => {
  if (!selectedPath) return
  clipboard = { path: selectedPath, mode: 'copy' }
  void window.api.clipboardSetFileOp(clipboard)
  writeSystemClipboard(selectedPath)
  updateActions()
}
const uniqueTarget = async (source: string, dir: string): Promise<string> => {
  let name = baseName(source)
  let target = joinPath(dir, name)
  if (source.toLowerCase() === target.toLowerCase()) return target
  if (await existsLike(target)) {
    const dot = name.lastIndexOf('.')
    name = dot > 0 ? `${name.slice(0, dot)} - 副本${name.slice(dot)}` : `${name} - 副本`
    target = joinPath(dir, name)
  }
  return target
}

const doPaste = (): void => void (async () => {
  const targetDir = activePath || home
  if (!clipboard) {
    // No internal copy/cut: try files from the system clipboard (e.g. copied in Explorer).
    const sources = await window.api.clipboardReadFiles()
    if (!sources.length) return
    try {
      for (const source of sources) await window.api.fsCopy(source, await uniqueTarget(source, targetDir))
      await render()
    } catch (e) { await confirmAction('粘贴失败：' + friendlyError(e)) }
    return
  }
  const source = clipboard.path
  try {
    if (clipboard.mode === 'copy') {
      await window.api.fsCopy(source, await uniqueTarget(source, targetDir))
    } else {
      // Cut keeps the original name; remove an existing destination first.
      const target = joinPath(targetDir, baseName(source))
      if (source.toLowerCase() !== target.toLowerCase() && await existsLike(target)) {
        await window.api.fsDelete(target)
      }
      if (source.toLowerCase() !== target.toLowerCase()) await window.api.fsMove(source, target)
    }
    clipboard = null
    await window.api.clipboardSetFileOp(null)
    selectedPath = ''
    await render()
  } catch (e) { await confirmAction('粘贴失败：' + friendlyError(e)) }
})()
const doRename = (): void => { if (selectedPath) inlineRename(selectedPath, baseName(selectedPath)) }
const doDelete = (): void => void (async () => {
  if (!selectedPath) return
  try { await window.api.fsDelete(selectedPath); selectedPath = ''; await render() }
  catch (e) { await confirmAction('删除失败：' + friendlyError(e)) }
})()
const doRefresh = (): void => void render()

document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
  if (event.key === 'F2') {
    if (selectedPath) { event.preventDefault(); doRename() }
    return
  }
  if (event.key === 'Delete') {
    if (selectedPath) { event.preventDefault(); doDelete() }
    return
  }
  if (!event.ctrlKey && !event.metaKey) return
  if (window.getSelection()?.toString()) return
  const key = event.key.toLowerCase()
  if (key === 'c') { event.preventDefault(); doCopy() }
  else if (key === 'x') { event.preventDefault(); doCut() }
  else if (key === 'v') { event.preventDefault(); doPaste() }
})
const openExternal = (): void => { if (selectedPath) void window.api.filesOpenExternal(selectedPath) }
const openTerminal = (target = ''): void => void (async () => {
  let dir = target || activePath || home
  if (!target && selectedPath) {
    const stat = await window.api.fsStat(selectedPath)
    if (stat?.isDirectory) dir = selectedPath
    else if (stat) dir = parentOf(selectedPath)
  }
  const err = await window.api.filesOpenTerminal(dir)
  if (err) await confirmAction(err)
})()

on('cut', 'click', doCut)
on('copy', 'click', doCopy)
on('paste', 'click', doPaste)
on('newFolder', 'click', createFolder)
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file'))) {
  button.addEventListener('click', () => createFile(button.dataset.name || '新建文件'))
}
on('rename', 'click', doRename)
on('delete', 'click', doDelete)
on('refresh', 'click', doRefresh)

const ctxMenu = $<HTMLElement>('ctxMenu')
const closeContextMenu = (): void => { ctxMenu.hidden = true }
const showContextMenu = (x: number, y: number, onRow: boolean, isDir: boolean, onBlank: boolean, isDrive: boolean): void => {
  const hidden: Record<string, boolean> = {
    external: !onRow, cut: !onRow, copy: !onRow,
    rename: !onRow, delete: !onRow, paste: !clipboard && !systemClipboardHasFiles,
    quickadd: !isDir || isDrive, folder: !onBlank || !activePath, filemenu: !onBlank || !activePath
  }
  for (const button of Array.from(ctxMenu.querySelectorAll<HTMLButtonElement>('button'))) {
    button.hidden = !!hidden[button.dataset.action || '']
  }
  for (const el of Array.from(ctxMenu.children)) {
    if (!el.classList.contains('ctx-sep')) continue
    let prev = el.previousElementSibling
    let next = el.nextElementSibling
    while (prev?.classList.contains('ctx-sep')) prev = prev.previousElementSibling
    while (next?.classList.contains('ctx-sep')) next = next.nextElementSibling
    ;(el as HTMLElement).hidden = !(prev instanceof HTMLButtonElement && !prev.hidden && next instanceof HTMLButtonElement && !next.hidden)
  }
  ctxMenu.hidden = false
  const rect = ctxMenu.getBoundingClientRect()
  ctxMenu.style.left = `${Math.min(x, innerWidth - rect.width - 6)}px`
  ctxMenu.style.top = `${Math.min(y, innerHeight - rect.height - 6)}px`
}
document.addEventListener('contextmenu', async event => {
  const target = event.target as HTMLElement
  if (target.closest('#ctxMenu')) return
  event.preventDefault()
  const row = target.closest<HTMLElement>('.table tr[data-path]')
  const sideItem = target.closest<HTMLElement>('.side-item[data-path]')
  let isDir = false
  let isDrive = false
  if (row) {
    selectedPath = row.dataset.path || ''
    menuTargetPath = selectedPath
    isDir = row.dataset.isdir === 'true'
    updateActions()
  } else if (sideItem) {
    selectedPath = ''
    menuTargetPath = sideItem.dataset.path || ''
    isDir = true
    isDrive = sideItem.classList.contains('drive-item')
    updateActions()
  } else {
    menuTargetPath = activePath || home
  }
  systemClipboardHasFiles = (await window.api.clipboardReadFiles()).length > 0
  showContextMenu(event.clientX, event.clientY, !!selectedPath, isDir, !row && !sideItem, isDrive)
})
ctxMenu.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
  if (!button || button.hidden) return
  closeContextMenu()
  if (button.classList.contains('new-file')) {
    createFile(button.dataset.name || '新建文件', menuTargetPath)
    return
  }
  const action = button.dataset.action
  if (action === 'external') openExternal()
  else if (action === 'terminal') openTerminal(menuTargetPath)
  else if (action === 'copypath' && menuTargetPath) void window.api.clipboardWriteText(menuTargetPath)
  else if (action === 'quickadd' && menuTargetPath) {
    addQuickFolder(menuTargetPath)
    void renderSidebar()
    void render()
  }
  else if (action === 'cut') doCut()
  else if (action === 'copy') doCopy()
  else if (action === 'paste') doPaste()
  else if (action === 'rename') doRename()
  else if (action === 'delete') doDelete()
  else if (action === 'folder') createFolder(menuTargetPath)
})
document.addEventListener('mousedown', event => {
  if (event.button === 0 && !(event.target as HTMLElement)?.closest('#ctxMenu')) closeContextMenu()
})
content.addEventListener('click', event => {
  if ((event.target as HTMLElement)?.closest('.table tr[data-path]')) return
  selectedPath = ''
  updateActions()
  content.querySelectorAll('.table tr').forEach(row => { (row as HTMLElement).style.background = '' })
})
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeContextMenu() })

window.api.onFsChanged(dir => { if (dir === activePath) void render() })

void (async () => {
  clipboard = await window.api.clipboardGetFileOp()
  await renderSidebar()
  await render()
})()

export {}
