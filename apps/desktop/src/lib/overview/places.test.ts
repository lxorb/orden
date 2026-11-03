import { expect, test } from 'vitest'
import { nextPlace, readPlaces } from './places.svelte'

test('a space is placed right of every other, level with the first', () => {
  expect(nextPlace({}, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  const one = { a: { x: 0, y: 0, w: 800, h: 600 }, b: { x: 960, y: 40, w: 600, h: 600 } }
  expect(nextPlace(one, { w: 700, h: 500 })).toEqual({ x: 1720, y: 0, w: 700, h: 500 })
})

test('what was written is read back, and what is not a place is left out', () => {
  expect(readPlaces({ a: { x: 1, y: 2, w: 3, h: 4 }, b: { x: 'no' }, c: null })).toEqual({
    a: { x: 1, y: 2, w: 3, h: 4 },
  })
  expect(readPlaces('nonsense')).toEqual({})
})
