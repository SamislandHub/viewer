/**
 * Single source of truth for local file classification.
 * Extension gives a fast hint; magic bytes give the truth when it disagrees.
 */
export type FileKind = 'image' | 'html' | 'text' | 'other'

const KIND_BY_EXT: Record<string, FileKind> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', jpe: 'image', jfif: 'image',
  gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image',
  ico: 'image', tif: 'image', tiff: 'image', heic: 'image', heif: 'image',
  // markup
  html: 'html', htm: 'html', xhtml: 'html', shtml: 'html', mhtml: 'html',
  // text / source
  txt: 'text', text: 'text', md: 'text', markdown: 'text', csv: 'text', tsv: 'text',
  css: 'text', scss: 'text', less: 'text', js: 'text', mjs: 'text', cjs: 'text',
  jsx: 'text', ts: 'text', tsx: 'text', json: 'text', jsonc: 'text', jsonl: 'text',
  xml: 'text', yaml: 'text', yml: 'text', toml: 'text', ini: 'text', cfg: 'text',
  conf: 'text', properties: 'text', env: 'text', log: 'text', diff: 'text',
  patch: 'text', lock: 'text', gitignore: 'text', gitattributes: 'text',
  py: 'text', pyw: 'text', java: 'text', c: 'text', h: 'text', cpp: 'text',
  hpp: 'text', cc: 'text', cs: 'text', go: 'text', rs: 'text', sh: 'text',
  bash: 'text', zsh: 'text', ps1: 'text', bat: 'text', cmd: 'text', sql: 'text',
  r: 'text', rb: 'text', php: 'text', swift: 'text', kt: 'text', kts: 'text',
  scala: 'text', lua: 'text', pl: 'text', dart: 'text', gradle: 'text',
  vue: 'text', svelte: 'text', mdx: 'text', rst: 'text', tex: 'text',
  srt: 'text', vtt: 'text', ipynb: 'text'
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
  jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif'
}

export function extensionOf(pathOrName: string): string {
  const name = pathOrName.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindByExtension(pathOrName: string): FileKind {
  return KIND_BY_EXT[extensionOf(pathOrName)] ?? 'other'
}

function matches(bytes: Uint8Array, offset: number, sig: number[]): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((value, i) => bytes[offset + i] === value)
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** Image MIME from the file's own signature, independent of its name. */
function imageMimeByMagic(bytes: Uint8Array): string | null {
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 'GIF8')) return 'image/gif'
  if (ascii(bytes, 0, 'BM')) return 'image/bmp'
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp'
  if (matches(bytes, 0, [0x00, 0x00, 0x01, 0x00]) || matches(bytes, 0, [0x00, 0x00, 0x02, 0x00])) return 'image/x-icon'
  if (matches(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || matches(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff'
  if (ascii(bytes, 4, 'ftyp')) {
    const brand = Array.from(bytes.subarray(8, 12), b => String.fromCharCode(b)).join('')
    if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1|jpeg)$/.test(brand)) return 'image/avif'
  }
  return null
}

/** Returns null when the header is binary and carries no recognisable signature. */
export function kindByMagic(bytes: Uint8Array): FileKind | null {
  if (imageMimeByMagic(bytes)) return 'image'

  // Known non-previewable containers. Without this, a PDF or DOCX whose header
  // has no NUL byte would be misclassified as plain text.
  if (ascii(bytes, 0, '%PDF-') || ascii(bytes, 0, '{\\rtf') || ascii(bytes, 0, '%!PS')
    || matches(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0])          // OLE: doc/xls/ppt
    || ascii(bytes, 0, 'PK\x03\x04')                        // zip-based: docx/xlsx/pptx
    || ascii(bytes, 0, '7z\xbc\xaf') || ascii(bytes, 0, 'Rar!')
    || matches(bytes, 0, [0x1f, 0x8b]) || ascii(bytes, 0, '\x7fELF')
    || ascii(bytes, 0, 'MZ')) return 'other'

  let start = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3
  let text = ''
  let binary = false
  for (let i = start; i < Math.min(bytes.length, start + 1024); i++) {
    const byte = bytes[i]
    if (byte === 0) { binary = true; break }
    text += String.fromCharCode(byte)
  }
  const head = text.trimStart().toLowerCase()
  if (/^<!doctype html|^<html[\s>]|^<head[\s>]|^<body[\s>]/.test(head)) return 'html'
  if (head.startsWith('<?xml')) {
    return text.slice(0, 1024).toLowerCase().includes('<svg') ? 'image' : 'text'
  }
  if (head.startsWith('<svg')) return 'image'
  return binary ? null : 'text'
}

export function mimeForImage(bytes: Uint8Array, pathOrName: string): string {
  return imageMimeByMagic(bytes) ?? IMAGE_MIME_BY_EXT[extensionOf(pathOrName)] ?? 'application/octet-stream'
}

/** Content wins over a misleading extension, except that fragments keep their HTML intent. */
export function resolveKind(fromExtension: FileKind, fromMagic: FileKind | null): FileKind {
  if (!fromMagic) return fromExtension
  if (fromMagic === 'text') return fromExtension === 'html' ? 'html' : 'text'
  return fromMagic
}
