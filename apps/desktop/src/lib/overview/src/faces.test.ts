import { expect, test } from 'vitest'
import { evicted, type Face, isFace, sizeOf } from './faces'

const face = (at: number, size: number): Face => ({
  html: 'x'.repeat(size),
  shot: null,
  w: 800,
  h: 600,
  at,
})

test('over the size, the oldest pictures go first, until the rest fit', () => {
  const kept: [string, Face][] = [
    ['new', face(30, 400)],
    ['old', face(10, 400)],
    ['mid', face(20, 400)],
  ]
  expect(evicted(kept, 900)).toEqual(['old'])
  expect(evicted(kept, 300)).toEqual(['old', 'mid', 'new'])
  expect(evicted(kept, 2000)).toEqual([])
  expect(sizeOf(face(1, 50))).toBe(50)
})

test('what the store gives back is a picture only if it says what one says', () => {
  expect(isFace(face(1, 2))).toBe(true)
  expect(isFace({ html: 1, shot: null, w: 1, h: 1, at: 1 })).toBe(false)
  expect(isFace(null)).toBe(false)
})
