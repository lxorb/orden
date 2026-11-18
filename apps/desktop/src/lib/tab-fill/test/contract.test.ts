import { describe, expect, test } from 'vitest'
import { atEdge, escapeLeaves, mayFill, mayHide, stillFills } from '../src/rules'

describe('filling the window', () => {
  test('is for a pane that shows something, on a desktop', () => {
    expect(mayFill('tab', false)).toBe(true)
    expect(mayFill(null, false)).toBe(false)
    expect(mayFill('tab', true)).toBe(false)
  })

  test('holds while its pane is worked in and shows something, and ends otherwise', () => {
    const filled = { fills: 'left', focusedId: 'left', showing: 'one' }
    expect(stillFills({ ...filled, showing: 'two' })).toBe(true)
    expect(stillFills({ ...filled, focusedId: 'right' })).toBe(false)
    expect(stillFills({ ...filled, showing: null })).toBe(false)
  })

  test('lets the bar go only when nothing holds it, and Escape ends it from outside a field or pane', () => {
    expect(mayHide({ pointer: false, keyboard: false, layers: 0 })).toBe(true)
    expect(mayHide({ pointer: true, keyboard: false, layers: 0 })).toBe(false)
    expect(escapeLeaves(null)).toBe(true)
    expect(atEdge(0)).toBe(true)
    expect(atEdge(200)).toBe(false)
  })
})
