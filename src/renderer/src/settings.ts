const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const consoleBox = $<HTMLInputElement>('setConsole')
const cursorBox = $<HTMLInputElement>('setCursor')
const downloadInput = $<HTMLInputElement>('setDownloadDir')
const downloadHint = $<HTMLElement>('setDownloadHint')

consoleBox.addEventListener('change', () => void window.api.settingsAction('console', consoleBox.checked))
cursorBox.addEventListener('change', () => void window.api.settingsAction('cursor', cursorBox.checked))
$('setClear').addEventListener('click', () => void window.api.settingsAction('clear', true))

function hint(text: string, isError = false): void {
  downloadHint.textContent = text
  downloadHint.classList.toggle('error', isError)
}

async function saveDownloadDir(): Promise<void> {
  const error = await window.api.settingsAction('downloadDir', downloadInput.value.trim())
  if (error) hint(error, true)
  else hint('已保存，之后的下载会使用此目录；留空则恢复默认目录。')
}

downloadInput.addEventListener('change', () => void saveDownloadDir())
downloadInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  void saveDownloadDir()
})
$('setBrowseDir').addEventListener('click', async () => {
  const dir = await window.api.settingsPickFolder()
  if (!dir) return
  downloadInput.value = dir
  await saveDownloadDir()
})
$('setOpenDownloadDir').addEventListener('click', () => {
  void window.api.downloadsOpenFolder().then(error => {
    if (error) hint(String(error), true)
  })
})

interface SettingsState {
  console: boolean
  cursor: boolean
  pin: boolean
  downloadDir: string
  ua: string
  platform: string
  languages: string
  brands: string
}

function applyState(state: SettingsState): void {
  consoleBox.checked = !!state.console
  cursorBox.checked = !!state.cursor
  // Don't overwrite text while the user is editing it.
  if (document.activeElement !== downloadInput) downloadInput.value = state.downloadDir || ''
  $('setInfo').innerHTML =
    `<div><b>UA</b>${state.ua}</div>` +
    `<div><b>平台</b>${state.platform}</div>` +
    `<div><b>语言</b>${state.languages}</div>` +
    `<div><b>Brands</b>${state.brands}</div>`
}

void window.api.settingsState?.().then(applyState)
window.api.onSettingsChanged?.(applyState)
