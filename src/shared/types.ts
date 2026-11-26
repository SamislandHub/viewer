export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Coordinates used by the virtual mouse are DIP on the virtual desktop. */
export interface CursorPosition extends Point {
  visible: boolean
}
