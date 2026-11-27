const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const content = $<HTMLElement>('content')

const TEXT_EXT = /\.(txt|md|csv|html|htm|css|js|ts|tsx|json|xml|log|ini|yaml|yml|py|java|c|cpp|h|go|rs|sh|bat|ps1)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

async function render(path: string): Promise<void> {
  const stat = await window.api.fsStat(path)
  $('title').textContent = baseName(path)
  $('meta').textContent = `${(stat.size / 1024).toFixed(1)} KB · ${new Date(stat.mtime).toLocaleString('zh-CN')}`
  $('openExternal').addEventListener('click', () => void window.api.filesOpenExternal(path))
  const box = document.createElement('div')
  box.className = 'preview-box'
  content.append(box)

  if (IMAGE_EXT.test(path)) {
    const img = document.createElement('img')
    img.src = 'file:///' + encodeURI(path.replace(/\\/g, '/'))
    img.alt = path
    box.append(img)
    return
  }
  if (TEXT_EXT.test(path)) {
    try {
      box.append(Object.assign(document.createElement('pre'), { textContent: await window.api.fsReadFile(path) }))
      return
    } catch { /* fall through to unified unsupported page */ }
  }
  box.replaceChildren()
  const unsupported = document.createElement('div')
  unsupported.className = 'unsupported'
  unsupported.append(
    Object.assign(document.createElement('div'), { className: 'icon', textContent: '📄' }),
    Object.assign(document.createElement('b'), { textContent: '无法预览此类型文件' }),
    Object.assign(document.createElement('p'), { textContent: baseName(path) }),
    (() => {
      const button = Object.assign(document.createElement('button'), {
        id: 'unsupportedOpen', textContent: '使用系统程序打开'
      })
      button.addEventListener('click', () => void window.api.filesOpenExternal(path))
      return button
    })()
  )
  box.append(unsupported)
}

void (async () => {
  const path = await window.api.previewPath()
  if (!path) {
    content.append(Object.assign(document.createElement('div'), { className: 'unsupported', textContent: '没有要预览的文件' }))
    return
  }
  try { await render(path) }
  catch (error) {
    content.replaceChildren(Object.assign(document.createElement('div'), { className: 'unsupported', textContent: String(error) }))
  }
})()

export {}
