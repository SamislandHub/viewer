import type { InspectedElement } from '../../main/dialog-bridge'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const elementCard = $<HTMLElement>('elementCard')
const pickHint = $<HTMLElement>('pickHint')
let picking = false

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (picking) void window.api.elementStopPick()
    elementCard.hidden = true
  }
})

for (const close of Array.from(document.querySelectorAll<HTMLButtonElement>('.popover-close'))) {
  close.addEventListener('click', () => { close.closest<HTMLElement>('.popover, .element-card')!.hidden = true })
}

function setPicking(active: boolean): void {
  picking = active
  pickHint.hidden = !active
  if (active) elementCard.hidden = true
}
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
    if (navigator.clipboard) void navigator.clipboard.writeText(element.outerHTML).catch(() => copyFallback(element.outerHTML))
    else copyFallback(element.outerHTML)
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
function showMessage(message: string): void {
  $('elementBody').textContent = message
  elementCard.hidden = false
}

window.api.onTabsChange(state => {
  const active = state.tabs.find(t => t.id === state.activeId)
  $<HTMLElement>('empty-page').style.display = state.hasPage ? 'none' : 'flex'
  $<HTMLElement>('page-slot').style.display = state.hasPage ? 'block' : 'none'
  document.title = active?.title && active.title !== '新标签页'
    ? `${active.title} - Viewer` : 'Viewer'
})
