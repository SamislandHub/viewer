import { kindByExtension, resolveKind } from '../../shared/file-types'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const content = $<HTMLElement>('content')

const ICON = {
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  showCode: '<svg viewBox="0 0 24 24"><path d="m9 18-6-6 6-6M15 6l6 6-6 6"/></svg>',
  showPreview: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M13 4h7v7M20 4l-9 9M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/></svg>',
  broken: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9.5 14l5 4M14.5 14l-5 4"/></svg>'
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function unsupported(message: string, name: string, withOpen = false): HTMLElement {
  const box = document.createElement('div')
  box.className = 'unsupported'
  box.append(
    Object.assign(document.createElement('div'), { className: 'icon', innerHTML: ICON.broken }),
    Object.assign(document.createElement('b'), { textContent: message }),
    Object.assign(document.createElement('p'), { textContent: name })
  )
  if (withOpen) {
    const button = Object.assign(document.createElement('button'), {
      type: 'button', title: '使用系统程序打开', innerHTML: `${ICON.external}<span>系统打开</span>`
    })
    button.addEventListener('click', () => void window.api.filesOpenExternal(currentPath))
    box.append(button)
  }
  return box
}

let currentPath = ''

async function render(path: string): Promise<void> {
  currentPath = path
  const stat = await window.api.fsStat(path)
  if (!stat) throw new Error('文件不存在')
  // Magic bytes beat a misleading extension; extension still covers plain text.
  const kind = resolveKind(kindByExtension(path), stat.kind)

  const name = baseName(path)
  const title = $<HTMLElement>('title')
  title.textContent = name
  title.title = path
  $('metaSize').textContent = formatSize(stat.size)
  $('metaTime').textContent = new Date(stat.mtime).toLocaleString('zh-CN', { hour12: false })

  const badge = $<HTMLElement>('fileIcon')
  const badgeStyle = kind === 'image' ? 'img'
    : kind === 'html' ? 'code'
    : kind === 'text' ? 'text'
    : 'file'
  const badgeIcon = kind === 'image' ? ICON.image
    : kind === 'html' ? ICON.code
    : kind === 'text' ? ICON.text
    : ICON.file
  badge.className = `file-icon ${badgeStyle}`
  badge.innerHTML = badgeIcon

  $('openExternal').addEventListener('click', () => void window.api.filesOpenExternal(path))

  const box = document.createElement('div')
  box.className = 'preview-box'
  content.append(box)

  if (kind === 'html') {
    box.classList.add('html')
    const modeBtn = $<HTMLButtonElement>('modeBtn')
    modeBtn.hidden = false
    modeBtn.innerHTML = ICON.showCode
    let sourceMode = false
    const setMode = (): void => {
      modeBtn.innerHTML = sourceMode ? ICON.showPreview : ICON.showCode
      modeBtn.title = sourceMode ? '返回预览' : '查看源码'
      modeBtn.setAttribute('aria-label', modeBtn.title)
    }
    const showPreview = (): void => void window.api.fsReadFile(path).then(html => {
      if (sourceMode) return
      box.replaceChildren()
      const iframe = document.createElement('iframe')
      const base = `<base href="file:///${encodeURI(path.replace(/\\/g, '/'))}">`
      iframe.srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : base + html
      box.append(iframe)
      setMode()
    }).catch(() => {
      box.replaceChildren(unsupported('无法读取 HTML 内容', name))
    })
    const showSource = (): void => void window.api.fsReadFile(path).then(text => {
      if (!sourceMode) return
      box.replaceChildren(Object.assign(document.createElement('pre'), { textContent: text }))
      setMode()
    }).catch(() => { /* keep current view */ })
    modeBtn.addEventListener('click', () => {
      sourceMode = !sourceMode
      if (sourceMode) showSource()
      else showPreview()
    })
    showPreview()
    return
  }
  if (kind === 'image') {
    box.classList.add('image')
    const img = document.createElement('img')
    img.alt = path
    box.append(img)
    void window.api.fsReadImage(path).then(dataUrl => { img.src = dataUrl }).catch(() => {
      box.replaceChildren(unsupported('图片读取失败', name, true))
    })
    return
  }
  if (kind === 'text') {
    try {
      box.classList.add('text')
      box.append(Object.assign(document.createElement('pre'), { textContent: await window.api.fsReadFile(path) }))
      return
    } catch { /* fall through to unified unsupported page */ }
  }
  box.append(unsupported('无法预览此类型文件', name, true))
}

void (async () => {
  const path = await window.api.previewPath()
  if (!path) {
    content.append(unsupported('没有要预览的文件', ''))
    return
  }
  try { await render(path) }
  catch (error) {
    content.replaceChildren(unsupported(String(error), ''))
  }
})()

export {}
