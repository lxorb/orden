import { describe, expect, test } from 'vitest'
import { spaced } from './dictation'

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
