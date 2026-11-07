import { expect, test } from 'vitest'
import { keptAt, overlaps, roomFor, settled, stripLanding } from './free'
import { cellAt } from './cells'
import { around } from './layout'
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
  expect(stripLanding(slots, 'x', { x: -260, y: 310, w: 200, h: 120 })).toEqual({
    paneId: 'p',
    before: 'c',
  })
  expect(stripLanding(slots, 'x', { x: 1150, y: 0, w: 200, h: 120 })).toEqual({
    paneId: 'other',
    before: null,
  })
  expect(stripLanding([], 'x', { x: 0, y: 0, w: 1, h: 1 })).toBe(null)
})

test('a window is never pushed onto the name under another, however much room the name takes', () => {
  const named = 140
  const windows = [at('a', 0, 0), at('b', 0, 150), at('c', 230, 100), at('held', 10, 260)]
  const after = settled(windows, new Set(['held']), named)
  for (const one of after) {
    for (const other of after) {
      if (one === other) continue
      const beside = one.x + one.w <= other.x || other.x + other.w <= one.x
      if (!beside && other.y >= one.y)
        expect(other.y).toBeGreaterThanOrEqual(one.y + one.h + named - 1)
    }
  }
  expect(after.every((a, i) => after.every((b, j) => i === j || !overlaps(a, b, named)))).toBe(true)
})

test('a held window pushes only the windows of the cell it is in, so a cell of one window it comes to is still there to point into', () => {
  const windows = [at('a1', 0, 0), at('a2', 240, 0), at('b1', 900, 0), at('held', 0, 0)]
  const cell = (id: string) => (id.startsWith('b') ? 'b' : 'a')
  const over = { x: 880, y: 10, w: 200, h: 120 }
  const inA = roomFor(windows, new Map([['held', over]]), (id) => cell(id) === 'a')
  expect(inA.find((one) => one.id === 'b1')).toEqual(windows[2])
  const box = (key: string) =>
    around(inA.filter((one) => one.id !== 'held' && cell(one.id) === key)) ?? over
  const cells = ['a', 'b'].map((key) => ({ key, box: box(key) }))
  expect(cellAt(cells, 'a', 980, 60)).toBe('b')
  const inB = roomFor(windows, new Map([['held', over]]), (id) => cell(id) === 'b')
  expect(inB.find((one) => one.id === 'b1')).not.toEqual(windows[2])
  expect(inB.filter((one) => cell(one.id) === 'a' && one.id !== 'held')).toEqual(
    windows.slice(0, 2),
  )
  expect(clear(inB.filter((one) => one.id !== 'a1' && one.id !== 'a2'))).toBe(true)
})

test('several windows held at once each stay under the hand, and the cell makes room for all', () => {
  const windows = [at('a1', 0, 0), at('a2', 228, 0), at('a3', 456, 0), at('x', 0, 300)]
  const held = new Map([
    ['x', { x: 200, y: 10, w: 200, h: 120 }],
    ['a3', { x: 428, y: 10, w: 200, h: 120 }],
  ])
  const out = roomFor(windows, held, () => true)
  expect(out.find((one) => one.id === 'x')).toMatchObject(held.get('x') ?? {})
  expect(out.find((one) => one.id === 'a3')).toMatchObject(held.get('a3') ?? {})
  expect(clear(out)).toBe(true)
})

test('windows each kept where they were put are moved apart where they lie on each other, at rest', () => {
  const windows = [at('a', 0, 0), at('b', 40, 30), at('c', 400, 0), at('d', 420, 20)]
  const still = new Set(['a', 'b', 'c', 'd'])
  expect(clear(settled(windows, still))).toBe(false)
  const after = settled(windows, still, 0, false)
  expect(clear(after)).toBe(true)
  expect(after[0]).toEqual(windows[0])
  expect(after[2]).toEqual(windows[2])
})

test('new windows opened among windows kept where they were let go never lie on any of them', () => {
  const kept: Slot[] = []
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 4; column++)
      kept.push(at(`k${row}${column}`, column * 228, row * 180))
  const still = new Set(kept.map((one) => one.id))
  const fresh = [at('n0', 120, 90), at('n1', 330, 100), at('n2', 560, 250), at('n3', 100, 20)]
  const after = settled([...kept, ...fresh], still, 0, false)
  expect(clear(after)).toBe(true)
  for (const one of kept) expect(after.find((other) => other.id === one.id)).toEqual(one)
})

test('whatever is kept and whatever is new, nothing lies on anything after', () => {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let run = 0; run < 60; run++) {
    const windows = Array.from({ length: 4 + Math.floor(random() * 20) }, (_, i) => ({
      ...at(`w${i}`, random() * 900, random() * 600),
      w: 80 + random() * 200,
      h: 60 + random() * 160,
    }))
    const still = new Set(windows.filter(() => random() < 0.6).map((one) => one.id))
    expect(clear(settled(windows, still, 0, false))).toBe(true)
  }
})

test('a window kept where it was let go takes the shape its pane has now', () => {
  const slot = { ...at('a', 0, 0), w: 300, h: 150 }
  expect(keptAt(slot, { x: 40, y: 50, w: 200, h: 200 })).toEqual({
    ...slot,
    x: 40,
    y: 50,
    w: 200,
    h: 100,
  })
})
