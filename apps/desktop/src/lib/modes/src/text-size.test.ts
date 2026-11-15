import { describe, expect, test } from 'vitest'
import { sizeStepFor } from './text-size'

function wheel(
  held: Partial<{ ctrlKey: boolean; deltaY: number; defaultPrevented: boolean }> = {},
) {
  return { ctrlKey: true, deltaY: -1, defaultPrevented: false, ...held }
}

describe('one notch of the wheel', () => {
  test('with Ctrl over the note is a step in or out', () => {
    expect(sizeStepFor(wheel({ deltaY: -1 }), true)).toBe(1)
    expect(sizeStepFor(wheel({ deltaY: 1 }), true)).toBe(-1)
  })

  test('is nothing without Ctrl, which is a scroll', () => {
    expect(sizeStepFor(wheel({ ctrlKey: false }), true)).toBe(0)
  })

  test('is nothing anywhere but over the note', () => {
    expect(sizeStepFor(wheel(), false)).toBe(0)
  })

  test('and nothing a surface with its own zoom has already answered', () => {
    expect(sizeStepFor(wheel({ defaultPrevented: true }), true)).toBe(0)
  })

  test('a wheel that moved nothing does nothing', () => {
    expect(sizeStepFor(wheel({ deltaY: 0 }), true)).toBe(0)
  })
})
