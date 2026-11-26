import { clipboard, type WebContents } from 'electron'

const KEYS: Record<string, { keyCode: string; modifiers?: string[] }> = {
  enter: { keyCode: 'Return' },
  tab: { keyCode: 'Tab' },
  backspace: { keyCode: 'Backspace' },
  escape: { keyCode: 'Escape' },
  space: { keyCode: ' ' },
  arrowup: { keyCode: 'Up' },
  arrowdown: { keyCode: 'Down' },
  arrowleft: { keyCode: 'Left' },
  arrowright: { keyCode: 'Right' },
  delete: { keyCode: 'Delete' },
  home: { keyCode: 'Home' },
  end: { keyCode: 'End' }
}

const MODIFIER_NAMES: Record<string, string> = {
  ctrl: 'control',
  control: 'control',
  alt: 'alt',
  shift: 'shift',
  meta: 'meta',
  command: 'meta',
  cmd: 'meta'
}

/**
 * Virtual keyboard using only Electron's webContents.sendInputEvent.
 *
 * No CDP session, no page JS, no DOM mutation. Events arrive in Chromium's
 * input pipeline and are isTrusted=true, just like hardware input.
 */
export class VirtualKeyboard {
  constructor(private readonly getTarget: () => WebContents | undefined) {}

  /** Insert text as trusted input. Chinese goes through clipboard + Ctrl+V. */
  async typeText(text: string): Promise<void> {
    const wc = this.getTarget()
    if (!wc || !text) return
    if (/[^\x00-\x7F]/.test(text)) {
      clipboard.writeText(text)
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] })
      return
    }
    for (const char of text) {
      wc.sendInputEvent({ type: 'char', keyCode: char })
    }
  }

  /** Press a key or combo, e.g. "Enter", "Ctrl+A", "Shift+Tab". */
  async pressKey(expression: string): Promise<void> {
    const wc = this.getTarget()
    if (!wc) return
    const parts = expression.split('+').map(p => p.trim().toLowerCase()).filter(Boolean)
    const keyName = parts.pop() ?? ''
    const modifiers = parts.map(p => MODIFIER_NAMES[p]).filter(Boolean) as
      Array<'shift' | 'control' | 'alt' | 'meta'>

    const keyCode = KEYS[keyName]?.keyCode
      ?? (keyName.length === 1 ? keyName.toUpperCase() : undefined)
    if (!keyCode) return

    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
}
