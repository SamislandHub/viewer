import type { Bookmark } from '../../main/bookmarks'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const urlInput = $<HTMLInputElement>('url')
const star = $<HTMLButtonElement>('bookmark')
let currentUrl = ''
let bookmarks: Bookmark[] = []
let urlEditing = false

function isUrlLike(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v)
    || /^[a-z]:[\\/]/i.test(v)
    || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(v)
}

function updateStarEnabled(): void {
  star.disabled = !isUrlLike(urlInput.value)
}

function displayUrl(url: string): string {
  if (!url || url === 'about:blank' || url.startsWith('data:')) return ''
  if (url === 'viewer://home' || url === 'viewer://newtab' || url === 'viewer://files') return ''
  for (const prefix of ['viewer://files/', 'viewer://preview/']) {
    if (url.startsWith(prefix)) {
      try { return decodeURIComponent(url.slice(prefix.length)) } catch { return url }
    }
  }
  if (url.startsWith('file:///')) return decodeURIComponent(url.slice(8)).replace(/\//g, '\\')
  return url
}
function updateStar(): void {
  const active = !!currentUrl && bookmarks.some(b => b.url === currentUrl)
  star.classList.toggle('active', active)
  star.title = star.disabled ? '请输入网址后再收藏'
    : active ? '取消收藏当前页 (Ctrl+D)' : '收藏当前页 (Ctrl+D)'
}
async function toggleBookmark(): Promise<void> {
  const result = await window.api.bookmarkToggle()
  bookmarks = result.bookmarks
  updateStar()
}

document.addEventListener('mousedown', () => void window.api.toolbarFocus())

let dragging = false
$('dragHandle').addEventListener('mousedown', e => {
  e.preventDefault()
  dragging = true
  void window.api.winDragStart()
})
document.addEventListener('mousemove', () => { if (dragging) void window.api.winDragMove() })
document.addEventListener('mouseup', () => { if (dragging) { dragging = false; void window.api.winDragEnd() } })
urlInput.addEventListener('focus', () => {
  urlEditing = true
  void window.api.setUrlInputFocused?.(true)
  urlInput.select()
})
urlInput.addEventListener('mousedown', e => {
  if (document.activeElement !== urlInput) {
    e.preventDefault()
    urlInput.focus()
    urlInput.select()
  }
})
urlInput.addEventListener('blur', () => {
  urlEditing = false
  void window.api.setUrlInputFocused?.(false)
})
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    urlEditing = false
    void window.api.setUrlInputFocused?.(false)
    urlInput.blur()
    void window.api.browserLoad(urlInput.value)
  }
})
urlInput.addEventListener('input', () => { updateStarEnabled(); updateStar() })
window.api.onInputText?.(text => {
  const start = urlInput.selectionStart ?? urlInput.value.length
  const end = urlInput.selectionEnd ?? start
  urlInput.setRangeText(text, start, end, 'end')
  updateStarEnabled()
  updateStar()
})
window.api.onInputKey?.(key => {
  const start = urlInput.selectionStart ?? urlInput.value.length
  const end = urlInput.selectionEnd ?? start
  if (key === 'Backspace') {
    if (start === end && start > 0) urlInput.setRangeText('', start - 1, start, 'end')
    else urlInput.setRangeText('', start, end, 'end')
  } else if (key === 'Delete') {
    if (start === end && start < urlInput.value.length) urlInput.setRangeText('', start, start + 1, 'start')
    else urlInput.setRangeText('', start, end, 'end')
  } else if (key === 'ArrowLeft') urlInput.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1))
  else if (key === 'ArrowRight') urlInput.setSelectionRange(Math.min(urlInput.value.length, start + 1), Math.min(urlInput.value.length, start + 1))
  updateStarEnabled()
  updateStar()
})
window.api.onInputEnter?.(() => void window.api.browserLoad(urlInput.value))

$('back').addEventListener('click', () => void window.api.browserBack())
$('forward').addEventListener('click', () => void window.api.browserForward())
$('reload').addEventListener('click', () => void window.api.browserReload())
$('home').addEventListener('click', () => void window.api.browserHome())
star.addEventListener('click', () => void toggleBookmark())
$('winmin').addEventListener('click', () => void window.api.winMinimize())
$('winmax').addEventListener('click', () => void window.api.winMaximize())
$('winclose').addEventListener('click', () => void window.api.winClose())
$('pinWindow').addEventListener('click', async () => {
  const pinned = !(await window.api.winIsPinned())
  await window.api.winPin(pinned)
  $('pinWindow').classList.toggle('active', pinned)
})
void window.api.winIsPinned?.().then(pinned => $('pinWindow').classList.toggle('active', pinned))

$('screenshot').addEventListener('click', () => void window.api.screenshotBegin())
$('pickElement').addEventListener('click', () => {
  const button = $('pickElement')
  if (button.classList.contains('active')) void window.api.elementStopPick()
  else void window.api.elementStartPick().then(ok => { if (!ok) button.title = '当前页面不支持元素选择' })
})
window.api.onElementMode(active => $('pickElement').classList.toggle('active', active))

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); void toggleBookmark() }
})

window.api.onTabsChange(state => {
  const active = state.tabs.find(t => t.id === state.activeId)
  currentUrl = active?.url ?? ''
  if (!urlEditing) urlInput.value = displayUrl(currentUrl)
  updateStarEnabled()
  updateStar()
})
window.api.onBookmarksUpdate(items => { bookmarks = items; updateStar() })
void Promise.all([
  window.api.tabList?.() ?? Promise.resolve([]),
  window.api.bookmarkList?.() ?? Promise.resolve([])
]).then(([tabs, savedBookmarks]) => {
  bookmarks = savedBookmarks
  currentUrl = tabs[0]?.url ?? ''
  urlInput.value = displayUrl(currentUrl)
  updateStarEnabled()
  updateStar()
})
