import type { Bookmark } from '../../main/bookmarks'
import type { HistoryEntry } from '../../main/history'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const LIMIT = 10

function makeEntry(title: string, url: string, meta: string, onClick: () => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'entry'
  row.title = url
  const fav = document.createElement('span')
  fav.className = 'fav'
  fav.textContent = (title || url).slice(0, 1).toUpperCase()
  const info = document.createElement('div')
  info.className = 'info'
  const t = document.createElement('div')
  t.className = 'title'
  t.textContent = title || url
  const u = document.createElement('div')
  u.className = 'url'
  u.textContent = url
  info.append(t, u)
  row.append(fav, info)
  if (meta) row.append(Object.assign(document.createElement('span'), { className: 'meta', textContent: meta }))
  row.addEventListener('click', onClick)
  return row
}

function renderBookmarks(items: Bookmark[]): void {
  const list = $('bookmarkList')
  list.replaceChildren()
  if (!items.length) {
    list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '暂无收藏' }))
    return
  }
  for (const item of items.slice(0, LIMIT)) {
    list.append(makeEntry(item.title, item.url, '', () => void window.api.bookmarkOpen(item.url)))
  }
}

function renderHistory(items: HistoryEntry[]): void {
  const list = $('historyList')
  list.replaceChildren()
  if (!items.length) {
    list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '暂无记录' }))
    return
  }
  for (const item of items.slice(0, LIMIT)) {
    const time = new Date(item.visitedAt).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
    list.append(makeEntry(item.title, item.url, time, () => void window.api.historyOpen(item.url)))
  }
}

for (const shortcut of Array.from(document.querySelectorAll<HTMLElement>('.shortcut'))) {
  shortcut.addEventListener('click', () => {
    const url = shortcut.dataset.url
    if (url) void window.api.internalOpen(url)
  })
}

$('openBookmarks').addEventListener('click', () => void window.api.internalOpen('viewer://bookmarks'))
$('openHistory').addEventListener('click', () => void window.api.internalOpen('viewer://history'))

window.api.onBookmarksUpdate?.(renderBookmarks)
window.api.onHistoryUpdate?.(renderHistory)
void Promise.all([
  window.api.bookmarkList?.() ?? Promise.resolve([]),
  window.api.historyList?.() ?? Promise.resolve([])
]).then(([bookmarks, history]) => {
  renderBookmarks(bookmarks)
  renderHistory(history)
})
