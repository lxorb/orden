import { expect, test } from 'vitest'
import { type Frame, pane } from '../workspace/pane-tree'
import { around, type Box, gridFor, lay, seamPath, seamsAmong } from './layout'

const room: Box = { x: 0, y: 0, w: 1200, h: 800 }

const panes = (tabs: Record<string, string[]>) => ({
  tabsOf: (id: string) => tabs[id] ?? [],
  shapeOf: () => 16 / 10,
})

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('one pane’s tabs are a grid of windows the pane’s shape, none over another', () => {
  const laid = lay(pane('p'), room, panes({ p: ['a', 'b', 'c', 'd', 'e'] }))
  expect(laid.slots.map((one) => one.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(laid.seams).toEqual([])
  for (const one of laid.slots) {
    expect(one.w / one.h).toBeCloseTo(16 / 10)
    expect(one.x).toBeGreaterThanOrEqual(0)
    expect(one.x + one.w).toBeLessThanOrEqual(1200)
    for (const other of laid.slots) if (other !== one) expect(overlaps(one, other)).toBe(false)
  }
})

test('one tab alone is a window on the canvas, not the pane again', () => {
  const [only] = lay(pane('p'), room, panes({ p: ['a'] })).slots
  expect(only?.w).toBeLessThan(room.w / 2)
  // In the middle.
  expect((only?.x ?? 0) + (only?.w ?? 0) / 2).toBeCloseTo(600)
})

test('a split side by side is two groups side by side with a seam down the gap', () => {
  const frame: Frame = {
    kind: 'split',
    id: 's',
    along: 'row',
    fraction: 0.5,
    sides: [pane('left'), pane('right')],
  }
  const laid = lay(frame, room, panes({ left: ['a', 'b'], right: ['c'] }))
  const left = around(laid.slots.filter((one) => one.paneId === 'left'))
  const right = around(laid.slots.filter((one) => one.paneId === 'right'))
  const [seam] = laid.seams
  expect(seam?.along).toBe('row')
  expect(left && right && seam).toBeTruthy()
  if (!left || !right || !seam) return
  expect(left.x + left.w).toBeLessThan(seam.from.x)
  expect(right.x).toBeGreaterThan(seam.from.x)
  expect(seam.from.x).toBe(seam.to.x)
  expect(seamPath(seam)).toMatch(/^M[\d.]+ [\d.]+ C/)
})

test('one above the other is two groups stacked, the seam across', () => {
  const frame: Frame = {
    kind: 'split',
    id: 's',
    along: 'column',
    fraction: 0.5,
    sides: [pane('top'), pane('bottom')],
  }
  const laid = lay(frame, room, panes({ top: ['a'], bottom: ['b'] }))
  const [top, bottom] = laid.slots
  expect(laid.seams[0]?.along).toBe('column')
  expect((top?.y ?? 0) + (top?.h ?? 0)).toBeLessThan(laid.seams[0]?.from.y ?? 0)
  expect(bottom?.y).toBeGreaterThan(laid.seams[0]?.from.y ?? 0)
})

test('the grid chosen gives each window the most room', () => {
  // Four windows in a wide room: two rows of two beat one row of four.
  expect(gridFor(4, 16 / 10, { x: 0, y: 0, w: 1000, h: 700 }, 1000).across).toBe(2)
  expect(gridFor(3, 16 / 10, { x: 0, y: 0, w: 2000, h: 300 }, 2000).across).toBe(3)
})

test('windows moved anywhere still have a seam between a split’s sides, where there is a gap', () => {
  const frame: Frame = {
    kind: 'split',
    id: 's',
    along: 'row',
    fraction: 0.5,
    sides: [pane('left'), pane('right')],
  }
  const slot = (id: string, paneId: string, x: number, y: number) => ({
    id,
    paneId,
    x,
    y,
    w: 100,
    h: 60,
  })
  const apart = seamsAmong(frame, [slot('a', 'left', 0, 0), slot('b', 'right', 300, 200)])
  expect(apart).toEqual([{ id: 's', along: 'row', from: { x: 200, y: 0 }, to: { x: 200, y: 260 } }])
  // One side's window moved in among the other's: no line across a window.
  expect(seamsAmong(frame, [slot('a', 'left', 0, 0), slot('b', 'right', 50, 100)])).toEqual([])
})

test('the rows leave room for the names under them, however much the names take', () => {
  const named = 180
  const laid = lay(pane('p'), room, { ...panes({ p: ['a', 'b', 'c', 'd', 'e'] }), named })
  const tops = [...new Set(laid.slots.map((one) => Math.round(one.y)))].sort((a, b) => a - b)
  expect(tops.length).toBeGreaterThan(1)
  const [first] = laid.slots
  for (let i = 1; i < tops.length; i++)
    expect((tops[i] ?? 0) - (tops[i - 1] ?? 0)).toBeGreaterThanOrEqual((first?.h ?? 0) + named - 1)
})
