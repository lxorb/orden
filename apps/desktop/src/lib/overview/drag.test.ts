import { expect, test } from 'vitest'
import { isDrag, landingAt, withMoved } from './drag'
import type { Slot } from './layout'

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
const strip = (paneId: string, before: string | null) => ({ kind: 'strip', paneId, before })

test('over the first half of a window it lands in front of it, over the second after it', () => {
  expect(landingAt(slots, 20, 30)).toEqual(strip('left', 'a'))
  expect(landingAt(slots, 80, 30)).toEqual(strip('left', 'b'))
  expect(landingAt(slots, 200, 30)).toEqual(strip('left', null))
})

test('in the gap it lands by the nearest window, in that window’s pane', () => {
  expect(landingAt(slots, 380, 30)).toEqual(strip('right', 'c'))
  expect(landingAt([], 0, 0)).toBe(null)
})

test('past a pane’s windows, far out, it still lands in a strip: the overview makes no pane', () => {
  expect(landingAt(slots, 100, 200)).toEqual(strip('left', 'b'))
  expect(landingAt(slots, 900, 30)).toEqual(strip('right', null))
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

test('a few pixels of wobble is still a press', () => {
  expect(isDrag(3, 3)).toBe(false)
  expect(isDrag(6, 0)).toBe(true)
})
