import type { TabInfo } from '../../main/browser'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const tabsEl = $<HTMLElement>('tabList')
const newTabSide = $<HTMLButtonElement>('newtab-side')
const leftPanel = $<HTMLElement>('left-panel')
const toggleSidebar = $<HTMLButtonElement>('toggleSidebar')
let tabs: TabInfo[] = []
let activeId: number | null = null

function defaultIcon(): HTMLElement {
  const span = document.createElement('span')
  span.className = 'tab-icon default-icon'
  return span
}
function renderTabs(): void {
  tabsEl.querySelectorAll('.tab').forEach(el => el.remove())
  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.loading ? ' loading' : '')
    el.title = tab.url
    if (tab.favicon) {
      const icon = document.createElement('img')
      icon.className = 'tab-icon'
      icon.src = tab.favicon
      icon.onerror = () => icon.replaceWith(defaultIcon())
      el.append(icon)
    } else el.append(defaultIcon())
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
    close.addEventListener('click', e => { e.stopPropagation(); void window.api.tabClose(tab.id) })
    el.append(close)
    el.addEventListener('click', () => void window.api.tabActivate(tab.id))
    tabsEl.insertBefore(el, newTabSide)
  }
}

let sidebarCollapsed = false
function applySidebar(): void {
  leftPanel.classList.toggle('collapsed', sidebarCollapsed)
  toggleSidebar.classList.toggle('collapsed', sidebarCollapsed)
  toggleSidebar.title = sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'
  void window.api.sidebarWidth(sidebarCollapsed ? 44 : 210)
}
document.addEventListener('mousedown', () => void window.api.sidebarFocus())
toggleSidebar.addEventListener('click', () => { sidebarCollapsed = !sidebarCollapsed; applySidebar() })
newTabSide.addEventListener('click', () => void window.api.tabNew())
$('openDownloads').addEventListener('click', () => void window.api.internalOpen('viewer://downloads'))
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); void window.api.tabNew() }
})

window.api.onTabsChange(state => {
  tabs = state.tabs
  activeId = state.activeId
  renderTabs()
})
void window.api.tabList?.().then(list => {
  tabs = list
  activeId = list[0]?.id ?? null
  renderTabs()
})
