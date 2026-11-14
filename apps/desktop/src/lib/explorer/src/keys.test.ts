import { describe, expect, test } from 'vitest'
import { stepped } from './keys'

describe("a file explorer's arrows", () => {
  test('walk a list a row at a time and leave the sideways keys alone', () => {
    expect(stepped('ArrowDown', null, 5, 1, 3)).toBe(0)
    expect(stepped('ArrowDown', 4, 5, 1, 3)).toBe(4)
    expect(stepped('ArrowUp', 0, 5, 1, 3)).toBe(0)
    expect(stepped('ArrowRight', 1, 5, 1, 3)).toBeNull()
    expect(stepped('PageDown', 0, 10, 1, 3)).toBe(3)
    expect(stepped('End', 0, 10, 1, 3)).toBe(9)
  })

  test('walk a grid across and down by its columns', () => {
    expect(stepped('ArrowRight', 2, 10, 4, 2)).toBe(3)
    expect(stepped('ArrowLeft', 0, 10, 4, 2)).toBe(0)
    expect(stepped('ArrowDown', 1, 10, 4, 2)).toBe(5)
    expect(stepped('ArrowDown', 7, 10, 4, 2)).toBe(9)
    expect(stepped('ArrowUp', 5, 10, 4, 2)).toBe(1)
    expect(stepped('PageDown', 0, 30, 4, 2)).toBe(8)
  })

  test('do nothing in an empty folder', () => {
    expect(stepped('ArrowDown', null, 0, 1, 3)).toBeNull()
  })
})
