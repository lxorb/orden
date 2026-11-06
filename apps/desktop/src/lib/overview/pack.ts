import type { Box } from './layout'

export interface Sized {
  key: string
  w: number
  h: number
}

export function meets(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap - 0.01 &&
    b.x < a.x + a.w + gap - 0.01 &&
    a.y < b.y + b.h + gap - 0.01 &&
    b.y < a.y + a.h + gap - 0.01
  )
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high))

export function packed(
  items: readonly Sized[],
  gap: number,
  taken: readonly Box[] = [],
  middle: { x: number; y: number } = { x: 0, y: 0 },
  wide = 1,
): Record<string, Box> {
  const placed: Box[] = [...taken]
  const out: Record<string, Box> = {}
  const far = (box: Box) =>
    Math.hypot((box.x + box.w / 2 - middle.x) / wide, box.y + box.h / 2 - middle.y)
  for (const item of items) {
    const { w, h } = item
    const best: { box: Box | null; off: number } = { box: null, off: Number.POSITIVE_INFINITY }
    const tryAt = (x: number, y: number) => {
      const box = { x, y, w, h }
      const off = far(box)
      if (off >= best.off - 1e-6) return
      if (placed.some((one) => meets(one, box, gap))) return
      best.box = box
      best.off = off
    }
    tryAt(middle.x - w / 2, middle.y - h / 2)
    if (!best.box) {
      const xs = [middle.x - w / 2]
      const ys = [middle.y - h / 2]
      for (const one of placed) {
        xs.push(one.x, one.x + one.w - w, one.x + one.w + gap, one.x - w - gap)
        ys.push(one.y, one.y + one.h - h, one.y + one.h + gap, one.y - h - gap)
      }
      for (const one of placed) {
        for (const x of [one.x + one.w + gap, one.x - w - gap])
          for (const y of ys) tryAt(x, clamp(y, one.y - h + 1, one.y + one.h - 1))
        for (const y of [one.y + one.h + gap, one.y - h - gap])
          for (const x of xs) tryAt(clamp(x, one.x - w + 1, one.x + one.w - 1), y)
      }
    }
    const box: Box = best.box ?? { x: middle.x - w / 2, y: middle.y - h / 2, w, h }
    placed.push(box)
    out[item.key] = box
  }
  return out
}

function clearAlong(a: Box, b: Box, x: number, y: number, gap: number): number {
  let least = Number.POSITIVE_INFINITY
  if (x > 1e-9) least = Math.min(least, (a.x + a.w + gap - b.x) / x)
  if (x < -1e-9) least = Math.min(least, (b.x + b.w + gap - a.x) / -x)
  if (y > 1e-9) least = Math.min(least, (a.y + a.h + gap - b.y) / y)
  if (y < -1e-9) least = Math.min(least, (b.y + b.h + gap - a.y) / -y)
  return Math.max(0, least)
}

export function pushedAside(
  held: Box,
  others: readonly { key: string; box: Box }[],
  gap: number,
  was: Readonly<Record<string, Box>> = {},
): Record<string, Box> {
  const middleOf = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
  const from = middleOf(held)
  const now = new Map(others.map(({ key, box }) => [key, { ...(was[key] ?? box) }]))
  const far = (key: string) => {
    const box = now.get(key)
    if (!box) return 0
    const at = middleOf(box)
    return Math.hypot(at.x - from.x, at.y - from.y)
  }
  const order = others.map(({ key }) => key).sort((a, b) => far(a) - far(b))
  for (let pass = 0; pass <= order.length; pass++) {
    let moved = false
    const pushers: Box[] = [held]
    for (const key of order) {
      const box = now.get(key)
      if (!box) continue
      for (const pusher of pushers) {
        if (!meets(pusher, box, gap)) continue
        const a = middleOf(pusher)
        const b = middleOf(box)
        const apart = Math.hypot(b.x - a.x, b.y - a.y)
        const x = apart > 1e-6 ? (b.x - a.x) / apart : 1
        const y = apart > 1e-6 ? (b.y - a.y) / apart : 0
        const by = clearAlong(pusher, box, x, y, gap)
        box.x += x * by
        box.y += y * by
        moved = true
      }
      pushers.push(box)
    }
    if (!moved) break
  }
  const out: Record<string, Box> = {}
  for (const { key, box } of others) {
    const at = now.get(key)
    if (at && (Math.abs(at.x - box.x) > 0.01 || Math.abs(at.y - box.y) > 0.01)) out[key] = at
  }
  return out
}
