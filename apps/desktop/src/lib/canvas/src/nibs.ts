import { type InkPoint, type InkStroke } from '@orden/markdown/canvas'
import { inkPath, outlineOf } from '../../plane/src/api'
import type { Nib } from './pens.svelte'

const SAMPLES = 44

function pressureAt(share: number): number {
  return 0.3 + 0.7 * Math.sin(Math.PI * share) ** 0.7
}

export function sampleStroke(nib: Nib, width: number, height: number): InkStroke {
  const room = Math.max(nib.size * 0.9, 3) + 2
  const middle = height / 2
  const swing = Math.max(0, height / 2 - room)
  const from = room
  const span = Math.max(1, width - 2 * room)

  const turns = nib.size > 10 ? 2 : 3

  const points: InkPoint[] = []

  for (let one = 0; one < SAMPLES; one++) {
    const share = one / (SAMPLES - 1)
    points.push({
      x: from + span * share,
      y: middle - Math.sin(share * Math.PI * turns) * swing * 0.82,
      pressure: pressureAt(share),
      tiltX: 0,
      tiltY: 0,
      t: Math.round(share * 700),
    })
  }

  return {
    id: 'sample',
    tool: nib.tool,
    color: nib.colour,
    size: nib.size,
    opacity: nib.opacity,
    points,
  }
}

export function samplePath(nib: Nib, width: number, height: number): string {
  return inkPath(outlineOf(sampleStroke(nib, width, height)))
}
