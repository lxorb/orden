import { expect, test } from 'vitest'
import { pane } from '../workspace/pane-tree'
import { isDrag, landingAt, MADE, withLanding, withMoved } from './drag'
import type { Room, Slot } from './layout'

const slot = (id: string, paneId: string, x: number, y = 0): Slot => ({
  id,
  paneId,
  x,
  y,
  w: 100,
  h: 60,
})

// The left pane's a and b side by side, the right pane's c past a gap.
const slots = [slot('a', 'left', 0), slot('b', 'left', 120), slot('c', 'right', 400)]
const rooms: Room[] = [
  { paneId: 'left', x: -100, y: -200, w: 420, h: 460 },
  { paneId: 'right', x: 360, y: -200, w: 300, h: 460 },
]
const strip = (paneId: string, before: string | null) => ({ kind: 'strip', paneId, before })

test('over the first half of a window it lands in front of it, over the second after it', () => {
  expect(landingAt(slots, rooms, 20, 30)).toEqual(strip('left', 'a'))
  expect(landingAt(slots, rooms, 80, 30)).toEqual(strip('left', 'b'))
  expect(landingAt(slots, rooms, 200, 30)).toEqual(strip('left', null))
})

test('in the gap it lands by the nearest window, in that window’s pane', () => {
  expect(landingAt(slots, rooms, 380, 30)).toEqual(strip('right', 'c'))
  expect(landingAt([], [], 0, 0)).toBe(null)
})

test('past a pane’s windows, in its room, it is against that side, where a pane may go', () => {
  expect(landingAt(slots, rooms, 100, 200)).toEqual({
    kind: 'side',
    paneId: 'left',
    side: 'bottom',
  })
  expect(landingAt(slots, rooms, 600, 30)).toEqual({ kind: 'side', paneId: 'right', side: 'right' })
  // Where the pane may not be split, it lands in the strip instead.
  expect(landingAt(slots, rooms, 600, 30, () => false)).toEqual(strip('right', null))
})

test('the canvas is laid out with it already where it would land', () => {
  const tabs: Record<string, string[]> = { left: ['a', 'b', 'x'], right: ['c'] }
  const of = (pane: string) => tabs[pane] ?? []
  expect(withMoved(of, 'x', { kind: 'strip', paneId: 'left', before: 'a' })('left')).toEqual([
    'x',
    'a',
    'b',
  ])
  const across = withMoved(of, 'x', { kind: 'strip', paneId: 'right', before: null })
  expect(across('left')).toEqual(['a', 'b'])
  expect(across('right')).toEqual(['c', 'x'])
  expect(withMoved(of, 'x', null)).toBe(of)
})

test('against a side, it is the one window of a pane split off there', () => {
  const landing = { kind: 'side', paneId: 'p', side: 'left' } as const
  const frame = withLanding(pane('p'), landing)
  expect(frame.kind === 'split' && frame.along).toBe('row')
  expect(frame.kind === 'split' && frame.sides[0].id).toBe(MADE)
  const of = withMoved(() => ['a', 'x'], 'x', landing)
  expect(of(MADE)).toEqual(['x'])
  expect(of('p')).toEqual(['a'])
})

test('a few pixels of wobble is still a press', () => {
  expect(isDrag(3, 3)).toBe(false)
  expect(isDrag(6, 0)).toBe(true)
})
