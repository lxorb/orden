import { describe, expect, test } from 'vitest'
import { walked } from './walk'

describe('walking a list with the keys', () => {
  test('steps down and up', () => {
    expect(walked('ArrowDown', 0, 4)).toBe(1)
    expect(walked('ArrowUp', 2, 4)).toBe(1)
  })

  test('goes to either end', () => {
    expect(walked('Home', 2, 4)).toBe(0)
    expect(walked('End', 1, 4)).toBe(3)
  })

  test('stops at the ends of a list that does not wrap', () => {
    expect(walked('ArrowDown', 3, 4)).toBe(3)
    expect(walked('ArrowUp', 0, 4)).toBe(0)
  })

  test('comes round on a list that does', () => {
    expect(walked('ArrowDown', 3, 4, true)).toBe(0)
    expect(walked('ArrowUp', 0, 4, true)).toBe(3)
  })

  /** A menu opened with the mouse has nothing under the cursor, and the first
   *  press should land where the key was pointing rather than at the top. */
  test('starts at the end the key came from', () => {
    expect(walked('ArrowDown', null, 4)).toBe(0)
    expect(walked('ArrowUp', null, 4)).toBe(3)
    expect(walked('Home', null, 4)).toBe(0)
    expect(walked('End', null, 4)).toBe(3)
  })

  test('leaves every other key alone', () => {
    expect(walked('Enter', 1, 4)).toBeNull()
    expect(walked('a', 1, 4)).toBeNull()
    expect(walked('ArrowRight', 1, 4)).toBeNull()
    expect(walked('PageDown', 1, 4)).toBeNull()
  })

  test('has nowhere to go in an empty list', () => {
    expect(walked('ArrowDown', null, 0)).toBeNull()
    expect(walked('End', null, 0)).toBeNull()
  })

  test('walks a list of one without moving', () => {
    expect(walked('ArrowDown', 0, 1, true)).toBe(0)
    expect(walked('ArrowUp', 0, 1, true)).toBe(0)
  })
})
