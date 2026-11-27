const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const content = $<HTMLElement>('content')
const modal = $<HTMLElement>('modal')
const modalTitle = $<HTMLElement>('modalTitle')
const modalInput = $<HTMLInputElement>('modalInput')

const TEXT_EXT = /\.(txt|md|csv|html|htm|css|js|ts|tsx|json|xml|log|ini|yaml|yml|py|java|c|cpp|h|go|rs|sh|bat|ps1)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i
const QUICK = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos']
const QUICK_NAMES: Record<string, string> = {
  Desktop: '桌面', Downloads: 'Downloads', Documents: '文档',
  Pictures: '图片', Music: '音乐', Videos: '视频'
}
const QUICK_ICONS: Record<string, string> = {
  Desktop: '🖥️', Downloads: '⬇️', Documents: '📄',
  Pictures: '🖼️', Music: '🎵', Videos: '🎬'
}

let activePath = new URLSearchParams(location.search).get('path') ?? ''
let home = ''
let selectedPath = ''
let clipboard: { path: string; mode: 'copy' | 'cut' } | null = null

interface RecentEntry { path: string; time: number }

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
  try { await window.api.fsStat(path); return true } catch { return false }
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
function iconFor(name: string, isDir: boolean): string {
  if (isDir) return '📁'
  if (IMAGE_EXT.test(name)) return '🖼️'
  if (TEXT_EXT.test(name)) return '📄'
  if (/\.(mp3|wav|flac|m4a)$/i.test(name)) return '🎵'
  if (/\.(mp4|mkv|avi|mov)$/i.test(name)) return '🎬'
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

function ask(title: string, value = ''): Promise<string | null> {
  modal.hidden = false
  modalTitle.textContent = title
  modalInput.hidden = false
  modalInput.value = value
  return new Promise(resolve => {
    const ok = $<HTMLButtonElement>('modalOk')
    const cancel = $<HTMLButtonElement>('modalCancel')
    const close = (result: string | null) => { modal.hidden = true; ok.onclick = null; cancel.onclick = null; resolve(result) }
    ok.onclick = () => close(modalInput.value.trim())
    cancel.onclick = () => close(null)
    modalInput.onkeydown = e => { if (e.key === 'Enter') close(modalInput.value.trim()) }
    modalInput.focus()
    modalInput.select()
  })
}
function friendlyError(error: unknown): string {
  const text = String(error)
  if (text.includes('EPERM') || text.includes('EACCES')) {
    return '当前进程以低完整性级别运行，没有权限写入该目录。请从普通终端（非沙箱）启动应用后再试。'
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

function updateActions(): void {
  const atDriveRoot = /^[a-z]:\\?$/i.test(activePath)
  for (const id of ['rename', 'delete', 'cut', 'copy']) {
    $<HTMLButtonElement>(id).disabled = !selectedPath
  }
  for (const id of ['newFolder', 'newFile', 'paste']) {
    const button = $<HTMLButtonElement>(id)
    button.disabled = atDriveRoot || (id === 'paste' && !clipboard)
    button.title = atDriveRoot ? '磁盘根目录不可写入，请先进入任意文件夹' : ''
  }
  $<HTMLButtonElement>('up').disabled = !activePath
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

function addTable(rows: { name: string; path: string; isDir: boolean; time?: number }[]): void {
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
    if (row.path === selectedPath) tr.style.background = '#e7f1ff'
    const nameTd = document.createElement('td')
    const nameCell = document.createElement('div')
    nameCell.className = 'name-cell'
    nameCell.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: iconFor(row.name, row.isDir) }),
      Object.assign(document.createElement('span'), { textContent: row.name })
    )
    nameTd.append(nameCell)
    tr.append(nameTd)
    tr.append(Object.assign(document.createElement('td'), { className: 'date', textContent: row.time ? formatTime(row.time) : '' }))
    tr.append(Object.assign(document.createElement('td'), { className: 'activity' }))
    tr.addEventListener('click', () => {
      selectedPath = row.path
      updateActions()
      table.querySelectorAll('tr').forEach(r => { (r as HTMLElement).style.background = '' })
      tr.style.background = '#e7f1ff'
    })
    tr.addEventListener('dblclick', () => openEntry(row.path, row.isDir))
    table.append(tr)
  }
  content.append(table)
}

async function renderSidebar(): Promise<void> {
  home = await window.api.filesHome()
  const quick = $<HTMLElement>('quickList')
  quick.replaceChildren()
  for (const dir of QUICK) {
    const path = joinPath(home, dir)
    const item = document.createElement('div')
    item.className = 'side-item'
    item.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: QUICK_ICONS[dir] }),
      Object.assign(document.createElement('span'), { textContent: QUICK_NAMES[dir] })
    )
    item.addEventListener('click', () => navigate(path))
    quick.append(item)
  }
  const drives = $<HTMLElement>('driveList')
  drives.replaceChildren()
  for (const drive of await window.api.fsDriveInfo()) {
    const item = document.createElement('div')
    item.className = 'side-item drive-item'
    const top = document.createElement('div')
    top.className = 'drive-top'
    top.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: '🖴' }),
      Object.assign(document.createElement('b'), { textContent: drive.path })
    )
    const used = drive.total ? Math.max(0, Math.min(100, (1 - drive.free / drive.total) * 100)) : 0
    const bar = document.createElement('div')
    bar.className = 'drive-bar'
    const fill = document.createElement('span')
    fill.style.width = `${used}%`
    bar.append(fill)
    const text = document.createElement('small')
    text.textContent = drive.total ? `${formatSize(drive.free)} 可用，共 ${formatSize(drive.total)}` : ''
    item.append(top, bar, text)
    item.addEventListener('click', () => navigate(drive.path))
    drives.append(item)
  }
}

async function renderRoot(): Promise<void> {
  content.append(title('快速访问'))
  const tiles = document.createElement('div')
  tiles.className = 'tiles'
  for (const dir of QUICK) {
    const path = joinPath(home, dir)
    const tile = document.createElement('div')
    tile.className = 'tile'
    tile.append(
      Object.assign(document.createElement('span'), { className: 'ico', textContent: QUICK_ICONS[dir] }),
      (() => {
        const label = document.createElement('div')
        label.className = 'label'
        label.append(
          Object.assign(document.createElement('b'), { textContent: QUICK_NAMES[dir] }),
          Object.assign(document.createElement('small'), { textContent: '本地存储' })
        )
        return label
      })()
    )
    tile.addEventListener('click', () => navigate(path))
    tiles.append(tile)
  }
  content.append(tiles)
  content.append(title('最近使用的文件'))
  const rows: { name: string; path: string; isDir: boolean; time: number }[] = []
  for (const entry of recent()) {
    try {
      const stat = await window.api.fsStat(entry.path)
      rows.push({ name: baseName(entry.path), path: entry.path, isDir: stat.isDirectory, time: entry.time })
    } catch { /* removed */ }
  }
  addTable(rows)
}

async function renderDirectory(path: string): Promise<void> {
  const entries = await window.api.fsList(path)
  const rows = await Promise.all(entries.map(async entry => {
    try {
      const stat = await window.api.fsStat(entry.path)
      return { name: entry.name, path: entry.path, isDir: entry.isDirectory, time: stat.mtime }
    } catch {
      return { name: entry.name, path: entry.path, isDir: entry.isDirectory, time: 0 }
    }
  }))
  addTable(rows)
}

async function render(): Promise<void> {
  content.replaceChildren()
  updateActions()
  try {
    if (!activePath) await renderRoot()
    else {
      const stat = await window.api.fsStat(activePath)
      if (stat.isDirectory) await renderDirectory(activePath)
      else {
        const box = document.createElement('div')
        box.className = 'preview'
        box.textContent = '此项目是文件，双击列表中的文件可在独立标签页预览。'
        content.append(box)
      }
    }
  } catch (error) {
    content.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: String(error) }))
  }
}

on('up', 'click', () => goUp())
on('newBtn', 'click', () => {
  const menu = $<HTMLElement>('newMenu')
  menu.hidden = !menu.hidden
})
document.addEventListener('click', event => {
  if (!(event.target as HTMLElement)?.closest('.new-wrap')) $<HTMLElement>('newMenu').hidden = true
})
$('newMenu').addEventListener('click', () => { $<HTMLElement>('newMenu').hidden = true })
on('cut', 'click', () => { if (!selectedPath) return; clipboard = { path: selectedPath, mode: 'cut' }; updateActions() })
on('copy', 'click', () => { if (!selectedPath) return; clipboard = { path: selectedPath, mode: 'copy' }; updateActions() })
on('paste', 'click', () => void (async () => {
  if (!clipboard) return
  const source = clipboard.path
  const targetDir = activePath || home
  let name = baseName(source)
  let target = joinPath(targetDir, name)
  if (await existsLike(target)) {
    const dot = name.lastIndexOf('.')
    name = dot > 0 ? `${name.slice(0, dot)} - 副本${name.slice(dot)}` : `${name} - 副本`
    target = joinPath(targetDir, name)
  }
  try {
    if (clipboard.mode === 'copy') await window.api.fsCopy(source, target)
    else await window.api.fsMove(source, target)
    clipboard = null
    selectedPath = ''
    await render()
  } catch (e) { await confirmAction('粘贴失败：' + friendlyError(e)) }
})())
on('newFolder', 'click', () => void (async () => {
  const name = await ask('新建文件夹名称', '新建文件夹')
  if (!name) return
  try { await window.api.fsCreateDir(activePath || home, name); await render() }
  catch (e) { await confirmAction('创建失败：' + friendlyError(e)) }
})())
on('newFile', 'click', () => void (async () => {
  const name = await ask('新建文件名称', '新建文本文档.txt')
  if (!name) return
  try { await window.api.fsCreateFile(activePath || home, name); await render() }
  catch (e) { await confirmAction('创建失败：' + friendlyError(e)) }
})())
on('rename', 'click', () => void (async () => {
  if (!selectedPath) return
  const name = await ask('新名称', baseName(selectedPath))
  if (!name || name === baseName(selectedPath)) return
  try { await window.api.fsRename(selectedPath, joinPath(parentOf(selectedPath), name)); selectedPath = ''; await render() }
  catch (e) { await confirmAction('重命名失败：' + friendlyError(e)) }
})())
on('delete', 'click', () => void (async () => {
  if (!selectedPath) return
  if (!await confirmAction(`确定删除「${baseName(selectedPath)}」吗？`)) return
  try { await window.api.fsDelete(selectedPath); selectedPath = ''; await render() }
  catch (e) { await confirmAction('删除失败：' + friendlyError(e)) }
})())
on('refresh', 'click', () => void render())

void (async () => {
  const path = await window.api.filesPath()
  if (path) activePath = path
  await renderSidebar()
  await render()
})()

export {}
