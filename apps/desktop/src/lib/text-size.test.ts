import { describe, expect, test } from 'vitest'
import { sizeStepFor } from './text-size'

/** Ctrl and the wheel over a note. What is being decided is small and the cost
 *  of getting it wrong is not: a wheel that changed the text size while somebody
 *  was scrolling would be unusable, and one the canvas had already answered would
 *  zoom twice. */

/** A wheel event as the rule reads one: Ctrl held, a notch up, nobody else has
 *  answered it. */
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
    // The sidebar, the tab strip, a sheet: the text size is the note's.
    expect(sizeStepFor(wheel(), false)).toBe(0)
  })

  test('and nothing a surface with its own zoom has already answered', () => {
    // The canvas, the graph and a page note each prevent the gesture on their own
    // element, which is what tells this to stand down.
    expect(sizeStepFor(wheel({ defaultPrevented: true }), true)).toBe(0)
  })

  test('a wheel that moved nothing does nothing', () => {
    expect(sizeStepFor(wheel({ deltaY: 0 }), true)).toBe(0)
  })
})
