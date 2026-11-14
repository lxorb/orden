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
  keepTogether = true,
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
        if (holdA && holdB && keepTogether) continue
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
  return apart(out, still, under, keepTogether)
}

function spotFor(one: Box, placed: readonly Box[], under: number): { x: number; y: number } {
  const free = (x: number, y: number) =>
    placed.every((other) => clearOf({ ...one, x, y }, other, under) === null)
  if (free(one.x, one.y)) return { x: one.x, y: one.y }
  let best = { x: one.x, y: one.y }
  let far = Number.POSITIVE_INFINITY
  for (const other of placed) {
    const right = other.x + other.w + APART_X
    const left = other.x - APART_X - one.w
    const below = other.y + other.h + under
    const above = other.y - under - one.h
    for (const [x, y] of [
      [right, one.y],
      [left, one.y],
      [one.x, below],
      [one.x, above],
      [right, other.y],
      [left, other.y],
      [other.x, below],
      [other.x, above],
    ] as const) {
      const off = Math.hypot(x - one.x, y - one.y)
      if (off < far && free(x, y)) {
        far = off
        best = { x, y }
      }
    }
  }
  return best
}

function apart<T extends Box & { id: string }>(
  windows: T[],
  still: ReadonlySet<string>,
  under: number,
  keepTogether: boolean,
): T[] {
  const fixed = (one: T) => keepTogether && still.has(one.id)
  const touching = windows.some((a, i) =>
    windows.some((b, j) => j > i && !(fixed(a) && fixed(b)) && clearOf(a, b, under) !== null),
  )
  if (!touching) return windows
  const order = [
    ...windows.filter(fixed),
    ...windows.filter((one) => !fixed(one) && still.has(one.id)),
    ...windows.filter((one) => !still.has(one.id)),
  ]
  const placed: Box[] = []
  for (const one of order) {
    if (!fixed(one)) Object.assign(one, spotFor(one, placed, under))
    placed.push(one)
  }
  return windows
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

export function keptAt<T extends Box>(slot: T, box: Box): T {
  return { ...slot, x: box.x, y: box.y, w: box.w, h: (box.w * slot.h) / Math.max(slot.w, 1) }
}
