import type { Camera } from '../camera'

interface Laid {
  y: number
  height: number
}

export function inSight(
  pages: readonly Laid[],
  camera: Camera,
  height: number,
  spare = height,
): { from: number; to: number } {
  const reach = (height / 2 + Math.max(0, spare)) / camera.scale
  const top = camera.y - reach
  const bottom = camera.y + reach

  let from = pages.length
  let to = 0
  for (const [at, page] of pages.entries()) {
    if (page.y + page.height < top || page.y > bottom) continue
    from = Math.min(from, at)
    to = at + 1
  }

  return from < to ? { from, to } : { from: 0, to: 0 }
}
