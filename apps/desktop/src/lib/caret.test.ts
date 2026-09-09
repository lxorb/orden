import { describe, expect, test } from 'vitest'
import { type Claims, type Showing, takesCaret } from './caret'

const NOTE: Showing = { kind: 'note', reading: false }
const CLEAR: Claims = { overlaid: false, renaming: false, presenting: false, touch: false }

describe('the caret when the note in front of somebody changes', () => {
  test('goes into the note, which is what opening one is for', () => {
    expect(takesCaret(NOTE, CLEAR)).toBe(true)
  })

  test('goes nowhere when there is no note showing', () => {
    expect(takesCaret(null, CLEAR)).toBe(false)
  })

  test('leaves a canvas, a paper and the graph to take their own keys', () => {
    expect(takesCaret({ kind: 'canvas', reading: false }, CLEAR)).toBe(false)
    expect(takesCaret({ kind: 'pdf', reading: false }, CLEAR)).toBe(false)
    expect(takesCaret({ kind: 'graph', reading: false }, CLEAR)).toBe(false)
  })

  test('goes nowhere in a note that is being read, which is a page', () => {
    expect(takesCaret({ kind: 'note', reading: true }, CLEAR)).toBe(false)
  })

  test('waits for whatever is over the note rather than taking the keys from it', () => {
    expect(takesCaret(NOTE, { ...CLEAR, overlaid: true })).toBe(false)
    expect(takesCaret(NOTE, { ...CLEAR, renaming: true })).toBe(false)
    expect(takesCaret(NOTE, { ...CLEAR, presenting: true })).toBe(false)
  })

  test('and stays out of the way on a finger’s screen, where it brings a keyboard', () => {
    expect(takesCaret(NOTE, { ...CLEAR, touch: true })).toBe(false)
  })
})
