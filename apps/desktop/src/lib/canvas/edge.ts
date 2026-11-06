import type { Camera } from '../camera'
import type { Point } from './geometry'

export const INSET = { top: 18, right: 18, bottom: 76, left: 18 } as const

export const ALONE_INSET = { ...INSET, top: 72 } as const

interface Inset {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

const STILL_SHOWN = 4

export interface Held {
  at: Point
  angle: number
  anchor: 'start' | 'middle' | 'end'
  baseline: 'auto' | 'middle' | 'hanging'
}

export function heldAtEdge(
  at: Point,
  camera: Camera,
  width: number,
  height: number,
  inset: Inset = INSET,
): Held | null {
  if (width <= 0 || height <= 0) return null

  const x = width / 2 + (at.x - camera.x) * camera.scale
  const y = height / 2 + (at.y - camera.y) * camera.scale

  const shown =
    x >= -STILL_SHOWN && x <= width + STILL_SHOWN && y >= -STILL_SHOWN && y <= height + STILL_SHOWN
  if (shown) return null

  const left = Math.min(inset.left, width / 2)
  const right = Math.max(width - inset.right, width / 2)
  const top = Math.min(inset.top, height / 2)
  const bottom = Math.max(height - inset.bottom, height / 2)
  const heldX = Math.min(right, Math.max(left, x))
  const heldY = Math.min(bottom, Math.max(top, y))

  const dx = x - heldX
  const dy = y - heldY
  const length = Math.hypot(dx, dy) || 1
  const across = dx / length
  const down = dy / length

  return {
    at: {
      x: camera.x + (heldX - width / 2) / camera.scale,
      y: camera.y + (heldY - height / 2) / camera.scale,
    },
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    anchor: across > 0.4 ? 'end' : across < -0.4 ? 'start' : 'middle',
    baseline: down > 0.4 ? 'auto' : down < -0.4 ? 'hanging' : 'middle',
  }
}
