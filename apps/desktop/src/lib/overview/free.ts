import type { Box, Slot } from './layout'

const APART_X = 28
const APART_Y = 60

const ROUNDS = 200

function clearOf(a: Box, b: Box, under = APART_Y): { x: number; y: number } | null {
  const right = a.x + a.w + APART_X - b.x
  const left = b.x + b.w + APART_X - a.x
  const down = a.y + a.h + under - b.y
  const up = b.y + b.h + under - a.y
  if (Math.min(right, left, down, up) <= 0.5) return null
  const ax = a.x + a.w / 2
  const bx = b.x + b.w / 2
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  const x = bx >= ax ? right : -left
  const y = by >= ay ? down : -up
  return Math.abs(x) * (under / APART_X) <= Math.abs(y) ? { x, y: 0 } : { x: 0, y }
}

export function settled<T extends Box & { id: string }>(
  windows: readonly T[],
  still: ReadonlySet<string>,
  named = 0,
): T[] {
  const under = Math.max(APART_Y, named)
  const out = windows.map((one) => ({ ...one }))
  for (let round = 0; round < ROUNDS; round++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        if (!a || !b) continue
        const away = clearOf(a, b, under)
        if (!away) continue
        const holdA = still.has(a.id)
        const holdB = still.has(b.id)
        if (holdA && holdB) continue
        const shareB = holdA ? 1 : holdB ? 0 : 0.5
        b.x += away.x * shareB
        b.y += away.y * shareB
        a.x -= away.x * (1 - shareB)
        a.y -= away.y * (1 - shareB)
        moved = true
      }
    }
    if (!moved) break
  }
  return out
}

export function roomFor<T extends Box & { id: string }>(
  windows: readonly T[],
  held: ReadonlyMap<string, Box>,
  mate: (id: string) => boolean,
  named = 0,
): T[] {
  const lying = windows.map((one) => {
    const box = held.get(one.id)
    return box ? { ...one, ...box } : one
  })
  const among = lying.filter((one) => held.has(one.id) || mate(one.id))
  const moved = new Map(settled(among, new Set(held.keys()), named).map((one) => [one.id, one]))
  return lying.map((one) => moved.get(one.id) ?? one)
}

export function readsBefore(a: Box, b: Box): number {
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  if (Math.abs(ay - by) < Math.min(a.h, b.h) / 2) return a.x + a.w / 2 - (b.x + b.w / 2)
  return ay - by
}

export function stripLanding(
  slots: readonly Slot[],
  id: string,
  box: Box,
): { paneId: string; before: string | null } | null {
  const others = slots.filter((one) => one.id !== id)
  let nearest: Slot | null = null
  let best = Number.POSITIVE_INFINITY
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  for (const one of others) {
    const dx = Math.max(one.x - cx, 0, cx - (one.x + one.w))
    const dy = Math.max(one.y - cy, 0, cy - (one.y + one.h))
    const far = Math.hypot(dx, dy)
    if (far < best) {
      best = far
      nearest = one
    }
  }
  if (!nearest) return null
  const paneId = nearest.paneId
  const ofPane = others.filter((one) => one.paneId === paneId).sort(readsBefore)
  const after = ofPane.find((one) => readsBefore(box, one) < 0)
  return { paneId, before: after?.id ?? null }
}

export function overlaps(a: Box, b: Box, named = 0): boolean {
  return clearOf(a, b, Math.max(APART_Y, named)) !== null
}
