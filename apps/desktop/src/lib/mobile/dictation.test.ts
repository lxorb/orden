import { describe, expect, test } from 'vitest'
import { spaced } from './dictation'

/** Where one heard sentence lands against the last one.
 *
 *  A recogniser answers in turns and each turn is a sentence with no space on
 *  either side of it, so two of them written straight into the note would come out
 *  as one word. */

describe('a sentence after a sentence', () => {
  test('is given the space the recogniser did not', () => {
    expect(spaced('.', 'And then we left')).toBe(' And then we left')
    expect(spaced('d', 'and then we left')).toBe(' and then we left')
  })

  test('is left alone where there is already a space, or a line, in front of it', () => {
    expect(spaced(' ', 'and then')).toBe('and then')
    expect(spaced('\n', 'and then')).toBe('and then')
  })

  test('is left alone at the very start of a note', () => {
    expect(spaced('', 'The plan')).toBe('The plan')
  })

  test('is nothing when nothing was heard', () => {
    expect(spaced('.', '')).toBe('')
  })
})
