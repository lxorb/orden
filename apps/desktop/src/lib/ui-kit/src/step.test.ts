import { describe, expect, test } from 'vitest'
import { stepped } from './step'

describe('walking a list with the keys', () => {
  test('steps down and up', () => {
    expect(stepped('ArrowDown', 0, 4)).toBe(1)
    expect(stepped('ArrowUp', 2, 4)).toBe(1)
  })

  test('goes to either end', () => {
    expect(stepped('Home', 2, 4)).toBe(0)
    expect(stepped('End', 1, 4)).toBe(3)
  })

  test('stops at the ends of a list that does not wrap', () => {
    expect(stepped('ArrowDown', 3, 4)).toBe(3)
    expect(stepped('ArrowUp', 0, 4)).toBe(0)
  })

  test('comes round on a list that does', () => {
    expect(stepped('ArrowDown', 3, 4, true)).toBe(0)
    expect(stepped('ArrowUp', 0, 4, true)).toBe(3)
  })

  test('starts at the end the key came from', () => {
    expect(stepped('ArrowDown', null, 4)).toBe(0)
    expect(stepped('ArrowUp', null, 4)).toBe(3)
    expect(stepped('Home', null, 4)).toBe(0)
    expect(stepped('End', null, 4)).toBe(3)
  })

  test('leaves every other key alone', () => {
    expect(stepped('Enter', 1, 4)).toBeNull()
    expect(stepped('a', 1, 4)).toBeNull()
    expect(stepped('ArrowRight', 1, 4)).toBeNull()
    expect(stepped('PageDown', 1, 4)).toBeNull()
  })

  test('has nowhere to go in an empty list', () => {
    expect(stepped('ArrowDown', null, 0)).toBeNull()
    expect(stepped('End', null, 0)).toBeNull()
  })

  test('walks a list of one without moving', () => {
    expect(stepped('ArrowDown', 0, 1, true)).toBe(0)
    expect(stepped('ArrowUp', 0, 1, true)).toBe(0)
  })
})
