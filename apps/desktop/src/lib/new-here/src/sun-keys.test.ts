import { describe, expect, test } from 'vitest'
import { MIDDLE, RESTING, walked } from './sun-keys'

const counts = [3, 1, 2, 2]
describe('the arrows on the sun', () => {
  test('do nothing until the middle is picked', () => {
    expect(walked(RESTING, 'ArrowUp', counts)).toBeNull()
  })
  test('from the middle, open the quarter they point at', () => {
    expect(walked(MIDDLE, 'ArrowUp', counts)).toEqual({ hub: false, open: 0, index: null })
    expect(walked(MIDDLE, 'ArrowLeft', counts)).toEqual({ hub: false, open: 3, index: null })
  })
  test('with three groups, point at the nearest of the three, and with none do nothing (#2557)', () => {
    const three = [2, 1, 1]
    expect(walked(MIDDLE, 'ArrowUp', three)).toEqual({ hub: false, open: 0, index: null })
    expect(walked(MIDDLE, 'ArrowRight', three)).toEqual({ hub: false, open: 1, index: null })
    expect(walked(MIDDLE, 'ArrowDown', three)).toEqual({ hub: false, open: 2, index: null })
    expect(walked({ hub: false, open: 1, index: 0 }, 'ArrowLeft', three)).toEqual(MIDDLE)
    expect(walked(MIDDLE, 'ArrowUp', [])).toBeNull()
  })
  test('across an open quarter walk its options clockwise and back, stopping at the ends', () => {
    const notes = { hub: false, open: 0, index: null }
    expect(walked(notes, 'ArrowRight', counts)).toEqual({ ...notes, index: 0 })
    expect(walked(notes, 'ArrowLeft', counts)).toEqual({ ...notes, index: 2 })
    expect(walked({ ...notes, index: 2 }, 'ArrowRight', counts)).toEqual({ ...notes, index: 2 })
    expect(walked({ ...notes, index: 1 }, 'ArrowLeft', counts)).toEqual({ ...notes, index: 0 })
  })
  test('turn with the quarter, so clockwise is down on the right and up on the left', () => {
    const chats = { hub: false, open: 1, index: null }
    expect(walked({ hub: false, open: 3, index: null }, 'ArrowUp', counts)).toEqual({ hub: false, open: 3, index: 0 })
    expect(walked(chats, 'ArrowDown', counts)).toEqual({ ...chats, index: 0 })
  })
  test('outward pick the middle option, inward go back to the middle', () => {
    expect(walked({ hub: false, open: 0, index: null }, 'ArrowUp', counts)).toEqual({ hub: false, open: 0, index: 1 })
    expect(walked({ hub: false, open: 0, index: 2 }, 'ArrowDown', counts)).toEqual(MIDDLE)
  })
  test('leave every other key alone', () => {
    expect(walked(MIDDLE, 'Enter', counts)).toBeNull()
  })
})
