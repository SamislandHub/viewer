import type { WebContents } from 'electron'

import type { Point } from '@shared/types'
import { buildPath, motionDuration } from './trajectory'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export interface MouseTarget {
  /** Which tab owns the input right now. */
  tabId: number
  /** The webContents that receives injected mouse events. */
  webContents: WebContents
  /** Current page viewport size, used to keep the cursor inside the app. */
  viewport: { width: number; height: number }
}

interface TabMouseState {
  position: Point
  visible: boolean
}

/**
 * Virtual cursor with independent state per tab.
 *
 * - Never touches the OS pointer; input goes through Chromium's input pipeline.
 * - The overlay window follows the active tab's cursor position and visibility.
 * - Closing a tab discards its state; reopening starts at the viewport center.
 */
export class VirtualMouse {
  private readonly states = new Map<number, TabMouseState>()
  private moveToken = 0
  private pressed = false
  private pressedButton: 'left' | 'right' = 'left'
  private targetOverride: WebContents | undefined

  constructor(private readonly getTarget: () => MouseTarget | undefined) {}

  /** While the file picker is open, route virtual input to the overlay view. */
  setTargetOverride(webContents?: WebContents): void {
    this.targetOverride = webContents
  }

  /** The webContents that currently receives virtual input. */
  getInputWebContents(): WebContents | undefined {
    return this.resolveTarget()?.webContents
  }

  private resolveTarget(): MouseTarget | undefined {
    const base = this.getTarget()
    if (!this.targetOverride) return base
    return {
      webContents: this.targetOverride,
      viewport: base?.viewport ?? { width: 0, height: 0 },
      tabId: base?.tabId ?? 0
    }
  }

  onMove?: (point: Point) => void
  onVisibility?: (visible: boolean) => void

  private currentState(): TabMouseState {
    const target = this.resolveTarget()
    const id = target?.tabId ?? 0
    let state = this.states.get(id)
    if (!state) {
      state = {
        position: {
          x: Math.round((target?.viewport.width ?? 800) / 2),
          y: Math.round((target?.viewport.height ?? 600) / 2)
        },
        visible: false
      }
      this.states.set(id, state)
    }
    return state
  }

  /** Active tab's cursor position. */
  getPosition(): Point {
    return { ...this.currentState().position }
  }

  /** Active tab's cursor visibility. */
  isVisible(): boolean {
    return this.currentState().visible
  }

  /** Tab switching: push that tab's saved state to the overlay. */
  activate(): void {
    const state = this.currentState()
    this.onMove?.({ ...state.position })
    this.onVisibility?.(state.visible)
  }

  /** Forget a closed tab's state. */
  remove(tabId: number): void {
    this.states.delete(tabId)
  }

  /** Discard all states (e.g. app restart). */
  clear(): void {
    this.states.clear()
  }

  private clampToViewport(point: Point): Point {
    const target = this.resolveTarget()
    if (!target) return point
    return {
      x: clamp(point.x, 0, Math.max(0, target.viewport.width)),
      y: clamp(point.y, 0, Math.max(0, target.viewport.height))
    }
  }

  jumpTo(point: Point): void {
    this.moveToken++
    const state = this.currentState()
    state.position = this.clampToViewport(point)
    this.onMove?.({ ...state.position })
  }

  nudge(dx: number, dy: number): void {
    const current = this.currentState().position
    this.jumpTo({ x: current.x + dx, y: current.y + dy })
  }

  async moveTo(target: Point): Promise<void> {
    const token = ++this.moveToken
    const state = this.currentState()
    const destination = this.clampToViewport(target)
    const distance = Math.hypot(destination.x - state.position.x, destination.y - state.position.y)
    const steps = Math.max(6, Math.min(40, Math.round(distance / 12)))
    const path = buildPath(state.position, destination, steps)
    const delay = Math.max(4, Math.round(motionDuration(distance) / path.length))

    for (const point of path) {
      if (token !== this.moveToken) return
      this.apply(point)
      await sleep(delay)
    }
  }

  /**
   * Click with the chosen button. `clickCount` > 1 sends successive down/up
   * pairs with clickCount 1..n so pages receive proper dblclick/triple events.
   */
  click(button: 'left' | 'right' = 'left', clickCount = 1): void {
    const target = this.resolveTarget()
    if (!target) return
    const position = this.currentState().position
    const { webContents } = target
    webContents.focus()
    const count = Math.max(1, Math.min(10, Math.round(clickCount)))
    try {
      for (let index = 1; index <= count; index++) {
        webContents.sendInputEvent({
          type: 'mouseDown', x: position.x, y: position.y, button, clickCount: index
        })
        this.pressed = true
        this.pressedButton = button
        webContents.sendInputEvent({
          type: 'mouseUp', x: position.x, y: position.y, button, clickCount: index
        })
        this.pressed = false
      }
    } finally {
      if (this.pressed) {
        webContents.sendInputEvent({
          type: 'mouseUp', x: position.x, y: position.y, button, clickCount: count
        })
        this.pressed = false
      }
    }
  }

  async moveAndClick(target: Point, button: 'left' | 'right' = 'left', clickCount = 1): Promise<void> {
    await this.moveTo(target)
    this.click(button, clickCount)
  }

  /** Inject a trusted wheel event at the current cursor position. */
  scroll(deltaX = 0, deltaY = 0): void {
    const target = this.resolveTarget()
    if (!target) return
    const position = this.currentState().position
    target.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: position.x,
      y: position.y,
      deltaX,
      deltaY,
      wheelTicksX: Math.round(deltaX / 100),
      wheelTicksY: Math.round(deltaY / 100),
      accelerationRatioX: 1,
      accelerationRatioY: 1
    })
  }

  setVisible(visible: boolean): void {
    this.currentState().visible = visible
    this.onVisibility?.(visible)
  }

  release(): void {
    if (!this.pressed) return
    const target = this.resolveTarget()
    const position = this.currentState().position
    target?.webContents.sendInputEvent({
      type: 'mouseUp', x: position.x, y: position.y, button: this.pressedButton, clickCount: 1
    })
    this.pressed = false
  }

  private apply(local: Point): void {
    const state = this.currentState()
    state.position = { ...local }
    this.resolveTarget()?.webContents.sendInputEvent({ type: 'mouseMove', x: local.x, y: local.y })
    this.onMove?.({ ...local })
  }
}
