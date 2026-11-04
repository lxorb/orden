import { expect, test } from 'vitest'
import { overlaps, settled, stripLanding } from './free'
import type { Slot } from './layout'

const at = (id: string, x: number, y: number, paneId = 'p'): Slot => ({
  id,
  paneId,
  x,
  y,
  w: 200,
  h: 120,
})

const clear = (all: readonly Slot[]) =>
  all.every((a, i) => all.every((b, j) => i === j || !overlaps(a, b)))

test('a window let go on others keeps its place, and they are pushed out of its way', () => {
  const windows = [at('a', 0, 0), at('b', 240, 0), at('c', 480, 0), at('held', 220, 20)]
  const after = settled(windows, new Set(['held']))
  expect(after.find((one) => one.id === 'held')).toEqual(windows[3])
  expect(clear(after)).toBe(true)
  // The one it was let go on was moved out of its way.
  expect(after.find((one) => one.id === 'b')).not.toEqual(windows[1])
})

test('windows clear of each other are not moved at all', () => {
  const windows = [at('a', 0, 0), at('b', 400, 0), at('c', 0, 400)]
  expect(settled(windows, new Set())).toEqual(windows)
})

test('whatever lies where, nothing lies on anything after, and what is held stays', () => {
  let seed = 11
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let run = 0; run < 40; run++) {
    const windows = Array.from({ length: 2 + Math.floor(random() * 10) }, (_, i) =>
      at(`w${i}`, random() * 600, random() * 400),
    )
    const still = new Set([`w0`])
    const after = settled(windows, still)
    expect(clear(after)).toBe(true)
    expect(after[0]).toEqual(windows[0])
  }
})

test('let go among a pane’s windows, it lands in its strip where it reads among them', () => {
  const slots = [at('a', 0, 0), at('b', 300, 0), at('c', 0, 300), at('q', 900, 0, 'other')]
  expect(stripLanding(slots, 'x', { x: 130, y: 10, w: 200, h: 120 })).toEqual({
    paneId: 'p',
    before: 'b',
  })
  // Below the first row, before the one on the second.
  expect(stripLanding(slots, 'x', { x: -260, y: 310, w: 200, h: 120 })).toEqual({
    paneId: 'p',
    before: 'c',
  })
  // Nearest another pane's window: into that pane, at its end.
  expect(stripLanding(slots, 'x', { x: 1150, y: 0, w: 200, h: 120 })).toEqual({
    paneId: 'other',
    before: null,
  })
  expect(stripLanding([], 'x', { x: 0, y: 0, w: 1, h: 1 })).toBe(null)
})

test('a window is never pushed onto the name under another, however much room the name takes', () => {
  // The camera drawn back: each name takes more of the canvas than the usual gap.
  const named = 140
  const windows = [at('a', 0, 0), at('b', 0, 150), at('c', 230, 100), at('held', 10, 260)]
  const after = settled(windows, new Set(['held']), named)
  for (const one of after) {
    for (const other of after) {
      if (one === other) continue
      const beside = one.x + one.w <= other.x || other.x + other.w <= one.x
      // Below one, the next window starts only past its name.
      if (!beside && other.y >= one.y)
        expect(other.y).toBeGreaterThanOrEqual(one.y + one.h + named - 1)
    }
  }
  expect(after.every((a, i) => after.every((b, j) => i === j || !overlaps(a, b, named)))).toBe(true)
})
