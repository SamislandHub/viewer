import type { DownloadRecord } from '../../main/downloads'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const filterInput = $<HTMLInputElement>('filter')
const list = $<HTMLElement>('list')

let items: DownloadRecord[] = []

const labels: Record<DownloadRecord['state'], string> = {
  progressing: '下载中', completed: '已完成', cancelled: '已取消',
  interrupted: '已中断', failed: '失败'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement('button')
  item.textContent = text
  item.addEventListener('click', onClick)
  return item
}

function render(): void {
  const keyword = filterInput.value.trim().toLowerCase()
  const visible = items.filter(item =>
    !keyword || item.filename.toLowerCase().includes(keyword) || item.url.toLowerCase().includes(keyword)
  )
  $('count').textContent = `${visible.length} / ${items.length}`
  list.replaceChildren()
  if (!visible.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = items.length ? '没有匹配的下载记录' : '还没有下载记录'
    list.append(empty)
    return
  }

  for (const item of visible) {
    const row = document.createElement('div')
    const done = item.state === 'completed'
    const failed = item.state === 'cancelled' || item.state === 'interrupted' || item.state === 'failed'
    row.className = 'entry' + (done ? ' done' : '') + (failed ? ' failed' : '')

    const top = document.createElement('div')
    top.className = 'entry-top'
    const fav = document.createElement('span')
    fav.className = 'fav'
    fav.textContent = '↓'
    top.append(fav)

    const info = document.createElement('div')
    info.className = 'info'
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = item.filename
    name.title = item.path
    const url = document.createElement('div')
    url.className = 'url'
    url.textContent = item.url
    url.title = item.url
    info.append(name, url)
    top.append(info)

    const state = document.createElement('span')
    const stateClass = done ? 'done' : failed ? 'failed' : 'active'
    state.className = 'state ' + stateClass
    const size = item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
      : formatBytes(item.receivedBytes)
    state.textContent = `${labels[item.state]} · ${size}`
    if (item.error) state.title = item.error
    top.append(state)
    row.append(top)

    const percent = item.totalBytes > 0
      ? Math.min(100, item.receivedBytes / item.totalBytes * 100)
      : (done ? 100 : 0)
    const track = document.createElement('div')
    track.className = 'progress'
    const bar = document.createElement('div')
    bar.style.width = `${percent}%`
    track.append(bar)
    row.append(track)

    const actions = document.createElement('div')
    actions.className = 'actions'
    if (done) actions.append(button('打开', () => void window.api.downloadsOpen(item.id)))
    actions.append(button('文件夹', () => void window.api.downloadsReveal(item.id)))
    if (item.state === 'interrupted') {
      actions.append(button('重试', () => void window.api.downloadsResume(item.id)))
    } else if (item.state === 'progressing') {
      actions.append(button('取消', () => void window.api.downloadsCancel(item.id)))
    }
    actions.append(button('移除', () => void window.api.downloadsRemove(item.id)))
    row.append(actions)
    list.append(row)
  }
}

function showError(message: string): void {
  const box = $('error')
  box.textContent = message
  box.hidden = !message
}

filterInput.addEventListener('input', render)
$('openFolder').addEventListener('click', () => {
  void window.api.downloadsOpenFolder().then(error => {
    showError(error ? `打开文件夹失败：${error}` : '')
  })
})
$('clearCompleted').addEventListener('click', () => void window.api.downloadsClearCompleted())

window.api.onDownloadsUpdate?.(entries => { items = entries; render() })
void window.api.downloadsList().then(entries => { items = entries; render() })
