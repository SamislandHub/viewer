const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const consoleBox = $<HTMLInputElement>('setConsole')
const cursorBox = $<HTMLInputElement>('setCursor')

consoleBox.addEventListener('change', () => void window.api.settingsAction('console', consoleBox.checked))
cursorBox.addEventListener('change', () => void window.api.settingsAction('cursor', cursorBox.checked))
$('setClear').addEventListener('click', () => void window.api.settingsAction('clear', true))

interface SettingsState {
  console: boolean
  cursor: boolean
  pin: boolean
  ua: string
  platform: string
  languages: string
  brands: string
}

function applyState(state: SettingsState): void {
  consoleBox.checked = !!state.console
  cursorBox.checked = !!state.cursor
  $('setInfo').innerHTML =
    `<div><b>UA</b>${state.ua}</div>` +
    `<div><b>平台</b>${state.platform}</div>` +
    `<div><b>语言</b>${state.languages}</div>` +
    `<div><b>Brands</b>${state.brands}</div>`
}

void window.api.settingsState?.().then(applyState)
window.api.onSettingsChanged?.(applyState)
