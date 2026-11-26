import type { TabInfo } from '../../main/browser'
import type { Bookmark } from '../../main/bookmarks'
import type { InspectedElement } from '../../main/dialog-bridge'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const urlInput = $<HTMLInputElement>('url')
const tabsEl = $<HTMLElement>('tabList')
const newTabSide = $<HTMLButtonElement>('newtab-side')
const leftPanel = $<HTMLElement>('left-panel')
const toggleSidebar = $<HTMLButtonElement>('toggleSidebar')
const star = $<HTMLButtonElement>('bookmark')
const elementCard = $<HTMLElement>('elementCard')
const pickHint = $<HTMLElement>('pickHint')

let tabs: TabInfo[] = []
let activeId: number | null = null
let bookmarks: Bookmark[] = []
let bookmarkedUrl = ''
let picking = false

function renderTabs(): void {
  tabsEl.innerHTML = ''
  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.loading ? ' loading' : '')
    el.title = tab.url

    // Favicon, restored through the shell renderer (no page JS involved).
    if (tab.favicon) {
      const icon = document.createElement('img')
      icon.className = 'tab-icon'
      icon.src = tab.favicon
      icon.onerror = () => { icon.replaceWith(makeDefaultIcon()) }
      el.append(icon)
    } else {
      el.append(makeDefaultIcon())
    }

    if (tab.loading) {
      const spinner = document.createElement('span')
      spinner.className = 'tab-spinner'
      el.append(spinner)
    }

    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = tab.title || '新标签页'
    el.append(title)

    const close = document.createElement('button')
    close.className = 'x'
    close.textContent = '×'
    close.title = '关闭标签页'
    close.addEventListener('click', e => {
      e.stopPropagation()
      void window.api.tabClose(tab.id)
    })
    el.append(close)

    el.addEventListener('click', () => void window.api.tabActivate(tab.id))
    tabsEl.append(el)
  }
  // The add button lives in the scrollable list, right after the last tab.
  tabsEl.append(newTabSide)
}

function makeDefaultIcon(): HTMLElement {
  const span = document.createElement('span')
  span.className = 'tab-icon default-icon'
  return span
}

// ---------- sidebar collapse / expand ----------

let sidebarCollapsed = false
function applySidebar(): void {
  leftPanel.classList.toggle('collapsed', sidebarCollapsed)
  toggleSidebar.classList.toggle('collapsed', sidebarCollapsed)
  toggleSidebar.title = sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'
  void window.api.sidebarWidth(sidebarCollapsed ? 44 : 210)
}
toggleSidebar.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed
  applySidebar()
})

function go(): void {
  void window.api.browserLoad(urlInput.value).catch(e => console.error(e))
}

urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
$('back').addEventListener('click', () => void window.api.browserBack())
$('forward').addEventListener('click', () => void window.api.browserForward())
$('reload').addEventListener('click', () => void window.api.browserReload())
$('home').addEventListener('click', () => void window.api.browserHome())
newTabSide.addEventListener('click', () => void window.api.tabNew())
$('openSettings').addEventListener('click', () => void window.api.settingsOpen())
$('openHistory').addEventListener('click', () => void window.api.internalOpen('viewer://history'))
$('openBookmarks').addEventListener('click', () => void window.api.internalOpen('viewer://bookmarks'))
$('openDownloads').addEventListener('click', () => void window.api.internalOpen('viewer://downloads'))
$('winmin').addEventListener('click', () => void window.api.winMinimize())
$('winmax').addEventListener('click', () => void window.api.winMaximize())
$('winclose').addEventListener('click', () => void window.api.winClose())

$('pinWindow').addEventListener('click', async () => {
  const pinned = !(await window.api.winIsPinned())
  await window.api.winPin(pinned)
  $('pinWindow').classList.toggle('active', pinned)
})
void window.api.winIsPinned?.().then(pinned => {
  $('pinWindow').classList.toggle('active', pinned)
})

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    void window.api.tabNew()
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    void toggleBookmark()
  }
  if (e.key === 'Escape') {
    if (picking) void window.api.elementStopPick()
    elementCard.hidden = true
  }
})

function displayUrl(url: string): string {
  if (!url || url === 'about:blank' || url.startsWith('data:')) return ''
  // The home page has no address; settings is a real internal page with one.
  if (url === 'viewer://home') return ''
  if (url.startsWith('file:///')) return decodeURIComponent(url.slice(8)).replace(/\//g, '\\')
  return url
}

// ---------- floating element card ----------

for (const close of Array.from(document.querySelectorAll<HTMLButtonElement>('.popover-close'))) {
  close.addEventListener('click', () => { close.closest<HTMLElement>('.popover, .element-card')!.hidden = true })
}

// ---------- bookmarks (star in the address bar) ----------

function updateStar(): void {
  const active = !!bookmarkedUrl && bookmarks.some(b => b.url === bookmarkedUrl)
  star.classList.toggle('active', active)
  star.title = active ? '取消收藏当前页 (Ctrl+D)' : '收藏当前页 (Ctrl+D)'
}

async function toggleBookmark(): Promise<void> {
  const result = await window.api.bookmarkToggle()
  bookmarks = result.bookmarks
  bookmarkedUrl = result.bookmarked ? activeUrl() : ''
  updateStar()
}

function activeUrl(): string {
  return tabs.find(t => t.id === activeId)?.url ?? ''
}

$('bookmark').addEventListener('click', () => void toggleBookmark())

// ---------- element selection ----------

function setPicking(active: boolean): void {
  picking = active
  $('pickElement').classList.toggle('active', active)
  pickHint.hidden = !active
  if (active) elementCard.hidden = true
}

$('pickElement').addEventListener('click', () => {
  if (picking) void window.api.elementStopPick()
  else {
    void window.api.elementStartPick().then(ok => {
      if (!ok) showMessage('当前页面不支持元素选择')
    })
  }
})

window.api.onElementMode(setPicking)
window.api.onElementPicked(element => {
  renderElement(element)
  elementCard.hidden = false
})

function renderElement(element: InspectedElement): void {
  const body = $('elementBody')
  body.replaceChildren()
  const lines: [string, string][] = [
    ['标签', element.tag ? `<${element.tag}>` : '—'],
    ['ID', element.id || '—'],
    ['类名', element.className || '—'],
    ['尺寸', element.width || element.height ? `${element.width} × ${element.height}` : '—'],
    ['文本', element.text || '—']
  ]
  for (const [key, value] of lines) {
    const line = make('div', 'element-line')
    line.append(make('span', 'key', key), make('span', 'val', value))
    body.append(line)
  }
  body.append(make('div', 'element-code', element.outerHTML || '—'))
  const actions = make('div', 'element-actions')
  const copy = make('button', 'mini', '复制 HTML')
  copy.addEventListener('click', () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(element.outerHTML).catch(() => copyFallback(element.outerHTML))
    } else {
      copyFallback(element.outerHTML)
    }
  })
  actions.append(copy)
  body.append(actions)
}

function copyFallback(text: string): void {
  const input = make('textarea', '', text)
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

// ---------- screenshot (UI lives on the topmost cursor layer) ----------

$('screenshot').addEventListener('click', () => void window.api.screenshotBegin())

function showMessage(message: string): void {
  $('elementBody').textContent = message
  elementCard.hidden = false
}

// The startup tab is created before this renderer loads, so its change event
// was missed. Pull the current list once on startup.
void Promise.all([
  window.api.tabList?.() ?? Promise.resolve([]),
  window.api.tabHasPage?.() ?? Promise.resolve(false),
  window.api.bookmarkList?.() ?? Promise.resolve([])
]).then(([list, hasPage, savedBookmarks]) => {
  tabs = list
  activeId = list[0]?.id ?? null
  bookmarks = savedBookmarks
  bookmarkedUrl = activeUrl()
  urlInput.value = displayUrl(bookmarkedUrl)
  renderTabs()
  updateStar()
  $<HTMLElement>('empty-page').style.display = hasPage ? 'none' : 'flex'
  $<HTMLElement>('page-slot').style.display = hasPage ? 'block' : 'none'
})

window.api.onTabsChange(state => {
  tabs = state.tabs
  activeId = state.activeId
  renderTabs()
  $<HTMLElement>('empty-page').style.display = state.hasPage ? 'none' : 'flex'
  $<HTMLElement>('page-slot').style.display = state.hasPage ? 'block' : 'none'
  const active = tabs.find(t => t.id === activeId)
  if (document.activeElement === urlInput) urlInput.blur()
  urlInput.value = displayUrl(active?.url ?? '')
  bookmarkedUrl = active?.url ?? ''
  updateStar()
  document.title = active?.title && active.title !== '新标签页'
    ? `${active.title} - Viewer` : 'Viewer'
})
