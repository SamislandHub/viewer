import type { Bookmark } from '../../main/bookmarks'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const filterInput = $<HTMLInputElement>('filter')
const clearButton = $<HTMLButtonElement>('clearAll')
const list = $<HTMLElement>('list')

let items: Bookmark[] = []

function render(): void {
  const keyword = filterInput.value.trim().toLowerCase()
  const visible = items.filter(item =>
    !keyword || item.title.toLowerCase().includes(keyword) || item.url.toLowerCase().includes(keyword)
  )
  $('count').textContent = `${visible.length} / ${items.length}`
  list.replaceChildren()
  if (!visible.length) {
    list.append(Object.assign(document.createElement('div'), {
      className: 'empty',
      textContent: items.length ? '没有匹配的收藏' : '还没有收藏，点击地址栏右侧的星标开始收藏'
    }))
    return
  }
  for (const item of visible) {
    const row = document.createElement('div')
    row.className = 'entry'
    row.title = item.url

    const fav = document.createElement('span')
    fav.className = 'fav'
    fav.textContent = (item.title || item.url).slice(0, 1).toUpperCase()
    row.append(fav)

    const info = document.createElement('div')
    info.className = 'info'
    const title = document.createElement('div')
    title.className = 'title'
    title.textContent = item.title || item.url
    const url = document.createElement('div')
    url.className = 'url'
    url.textContent = item.url
    info.append(title, url)
    row.append(info)

    const remove = document.createElement('button')
    remove.className = 'remove'
    remove.textContent = '×'
    remove.title = '删除收藏'
    remove.addEventListener('click', e => {
      e.stopPropagation()
      void window.api.bookmarkRemove(item.id)
    })
    row.append(remove)
    row.addEventListener('click', () => void window.api.bookmarkOpen(item.url))
    list.append(row)
  }
}

filterInput.addEventListener('input', render)

let confirming = false
let confirmTimer: number | undefined
function resetClear(): void {
  confirming = false
  clearButton.textContent = '清空收藏'
  clearButton.classList.remove('confirm')
}
clearButton.addEventListener('click', () => {
  if (!confirming) {
    confirming = true
    clearButton.textContent = '确认清空？'
    clearButton.classList.add('confirm')
    window.clearTimeout(confirmTimer)
    confirmTimer = window.setTimeout(resetClear, 3000)
    return
  }
  window.clearTimeout(confirmTimer)
  resetClear()
  void window.api.bookmarkClear()
})

window.api.onBookmarksUpdate?.(entries => { items = entries; render() })
void window.api.bookmarkList().then(entries => { items = entries; render() })
