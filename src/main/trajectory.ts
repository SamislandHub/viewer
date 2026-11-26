import type { Point } from '@shared/types'

const ease = (t: number): number => t * t * (3 - 2 * t)

function bezier(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/** Smooth, slightly curved path with a small wobble. Last point is exact. */
export function buildPath(from: Point, to: Point, steps = 24): Point[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance < 1) return [{ ...to }]

  const nx = -dy / distance
  const ny = dx / distance
  const bend = Math.min(40, distance * 0.08) * (Math.random() < 0.5 ? -1 : 1)

  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend }
  const c2 = { x: from.x + dx * 0.7 + nx * bend * 0.5, y: from.y + dy * 0.7 + ny * bend * 0.5 }

  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const t = ease(i / steps)
    const wobble = Math.sin(Math.PI * t) * (Math.random() - 0.5) * 0.6
    points.push({
      x: bezier(from.x, c1.x, c2.x, to.x, t) + nx * wobble,
      y: bezier(from.y, c1.y, c2.y, to.y, t) + ny * wobble
    })
  }
  points[points.length - 1] = { ...to }
  return points
}

export function motionDuration(distance: number): number {
  if (distance < 150) return 180
  if (distance < 500) return 300
  return 420
}
