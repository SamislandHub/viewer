import type { ResourceRecord } from '../../main/resource-monitor'

interface TabInfo { id: number; title: string; url: string; loading: boolean }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const urlInput = $<HTMLInputElement>('url')
const mx = $<HTMLInputElement>('mx')
const my = $<HTMLInputElement>('my')
const space = $<HTMLSelectElement>('space')
const pos = $<HTMLElement>('pos')
const tabsEl = $<HTMLElement>('tabs')
const currentPage = $<HTMLElement>('current-page')

let tabs: TabInfo[] = []
let activeId: number | null = null

function renderTabs(): void {
  tabsEl.innerHTML = ''
  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.loading ? ' loading' : '')
    el.title = tab.url

    if (tab.loading) {
      const spinner = document.createElement('span')
      spinner.className = 'tab-spinner'
      el.append(spinner)
    }

    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = tab.title || '新标签页'

    const close = document.createElement('button')
    close.className = 'x'
    close.textContent = '×'
    close.title = '关闭标签页'
    close.addEventListener('click', e => {
      e.stopPropagation()
      void window.api.tabClose(tab.id)
    })

    el.append(title, close)
    el.addEventListener('click', () => void window.api.tabActivate(tab.id))
    tabsEl.append(el)
  }
}

function go(): void {
  void window.api.browserLoad(urlInput.value).catch(e => console.error(e))
}

urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
$('back').addEventListener('click', () => void window.api.browserBack())
$('forward').addEventListener('click', () => void window.api.browserForward())
$('reload').addEventListener('click', () => void window.api.browserReload())

$('newtab-side').addEventListener('click', () => void window.api.tabNew())
$('winmin').addEventListener('click', () => void window.api.winMinimize())
$('winmax').addEventListener('click', () => void window.api.winMaximize())
$('winclose').addEventListener('click', () => void window.api.winClose())

const coords = () => ({ x: Number(mx.value), y: Number(my.value), s: space.value as 'page' | 'screen' })

$('move').addEventListener('click', () => { const c = coords(); void window.api.vmMove(c.x, c.y, c.s) })
const clickOptions = () => ({
  button: ($('clickButton') as HTMLSelectElement).value as 'left' | 'right',
  clickCount: Number(($('clickCount') as HTMLInputElement).value) || 1
})

$('click').addEventListener('click', () => {
  const o = clickOptions()
  void window.api.vmClick(o.button, o.clickCount)
})
$('moveClick').addEventListener('click', () => {
  const c = coords()
  const o = clickOptions()
  void window.api.vmMoveClick(c.x, c.y, c.s, o.button, o.clickCount)
})
$('center').addEventListener('click', () => void window.api.vmCenter())
$('wheelUp').addEventListener('click', () => {
  void window.api.vmScroll(0, -Number(($('wheelAmount') as HTMLInputElement).value))
})
$('wheelDown').addEventListener('click', () => {
  void window.api.vmScroll(0, Number(($('wheelAmount') as HTMLInputElement).value))
})
$('kbType').addEventListener('click', () => {
  void window.api.kbType(($('kbText') as HTMLInputElement).value)
})
$('kbPress').addEventListener('click', () => {
  void window.api.kbPress(($('kbKey') as HTMLSelectElement).value)
})

// On-screen English keyboard
let shiftOn = false
const shiftKey = document.querySelector<HTMLButtonElement>('#enKeyboard [data-key="Shift"]')!
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#enKeyboard button'))) {
  button.addEventListener('click', () => {
    const key = button.dataset.key ?? ''
    if (key === 'Shift') {
      shiftOn = !shiftOn
      shiftKey.classList.toggle('active', shiftOn)
      return
    }
    if (key.length === 1 && /[a-z]/.test(key)) {
      void window.api.kbType(shiftOn ? key.toUpperCase() : key)
      shiftOn = false
      shiftKey.classList.remove('active')
    } else {
      void window.api.kbPress(key)
    }
  })
}
$<HTMLInputElement>('visible').addEventListener('change', e => {
  void window.api.vmVisible((e.target as HTMLInputElement).checked)
})

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    void window.api.tabNew()
    return
  }
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  const step = e.shiftKey ? 20 : 5
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
  }
  if (moves[e.key]) {
    e.preventDefault()
    void window.api.vmNudge(...moves[e.key])
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = clickOptions()
    void window.api.vmClick(o.button, o.clickCount)
  }
})

function displayUrl(url: string): string {
  if (!url || url === 'about:blank' || url.startsWith('data:')) return ''
  if (url.startsWith('file:///')) {
    return decodeURIComponent(url.slice(8)).replace(/\//g, '\\')
  }
  return url
}

window.api.onTabsChange(state => {
  tabs = state.tabs
  activeId = state.activeId
  renderTabs()
  const active = tabs.find(t => t.id === activeId)
  // Always follow the active tab, even if the old URL is still focused.
  if (document.activeElement === urlInput) urlInput.blur()
  urlInput.value = displayUrl(active?.url ?? '')
  currentPage.textContent = active?.title && active.title !== '新标签页' ? active.title : '当前页面'
  document.title = active?.title && active.title !== '新标签页'
    ? `${active.title} - Viewer` : 'Viewer'
})

window.api.onCursorMove(point => {
  pos.textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`
})

window.api.onCursorVisible(visible => {
  ($('visible') as HTMLInputElement).checked = visible
})

void window.api.vmPosition().then(p => {
  pos.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`
})

// ---------- resource analysis ----------

let resources: ResourceRecord[] = []
let resFilter = 'all'
const resList = $<HTMLElement>('resList')
const resDetail = $<HTMLElement>('resDetail')

function resMatches(record: ResourceRecord): boolean {
  if (resFilter === 'all') return true
  const type = record.resourceType.toLowerCase()
  if (resFilter === 'xhr') return type === 'xhr' || type === 'fetch'
  if (resFilter === 'other') {
    return !['xhr', 'fetch', 'document', 'script', 'stylesheet', 'image'].includes(type)
  }
  return type === resFilter
}

function renderResources(): void {
  resList.innerHTML = ''
  const shown = resources.filter(resMatches)
  for (const record of shown.slice(0, 200)) {
    const row = document.createElement('div')
    row.className = 'res-row'

    const method = document.createElement('span')
    method.className = 'res-method'
    method.textContent = record.method

    const status = document.createElement('span')
    status.className = 'res-status' + (record.status >= 400 || record.status === 0 ? ' err' : '')
    status.textContent = record.status ? String(record.status) : 'ERR'

    const url = document.createElement('span')
    url.className = 'res-url'
    url.textContent = record.url
    url.title = record.url

    const time = document.createElement('span')
    time.className = 'res-time'
    time.textContent = `${Math.round(record.durationMs)}ms`

    row.append(method, status, url, time)
    row.addEventListener('click', () => {
      resDetail.textContent =
        `${record.method} ${record.url}\n` +
        `status: ${record.status} ${record.statusText}\n` +
        `type: ${record.resourceType}  mime: ${record.mimeType || '-'}\n` +
        `duration: ${Math.round(record.durationMs)}ms  cache: ${record.fromCache ? 'yes' : 'no'}\n` +
        `tab webContents: ${record.webContentsId}` +
        (record.error ? `\nerror: ${record.error}` : '')
    })
    resList.append(row)
  }
}

$('resFilter').addEventListener('change', e => {
  resFilter = (e.target as HTMLSelectElement).value
  renderResources()
})
$('resClear').addEventListener('click', () => {
  void window.api.resourcesClear?.()
  resources = []
  renderResources()
  resDetail.textContent = '点击请求查看详情'
})

window.api.onResourcesUpdate?.(records => {
  resources = records
  renderResources()
})
void window.api.resourcesList?.()?.then(records => {
  resources = records
  renderResources()
})

