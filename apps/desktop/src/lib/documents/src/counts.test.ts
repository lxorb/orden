import { describe, expect, test } from 'vitest'
import { countText } from './counts'

describe('what the status bar counts', () => {
  test('an empty note counts nothing, and still reads in a minute', () => {
    expect(countText('')).toEqual({ words: 0, characters: 0, lines: 0, minutes: 1 })
  })

  test('words, characters and lines', () => {
    expect(countText('one two three\nfour')).toMatchObject({
      words: 4,
      characters: 18,
      lines: 2,
    })
  })

  test('runs of whitespace are one gap, not several words', () => {
    expect(countText('  one   two \t three \n\n four  ').words).toBe(4)
  })

  test('a trailing newline does not open a line that is not there', () => {
    expect(countText('one\ntwo').lines).toBe(2)
    expect(countText('one\ntwo\n').lines).toBe(3)
  })

  test('reading time rounds, and never says nothing', () => {
    expect(countText(Array(200).fill('word').join(' ')).minutes).toBe(1)
    expect(countText(Array(700).fill('word').join(' ')).minutes).toBe(4)
  })

  test('a no-break space between words still separates them', () => {
    expect(countText('one two').words).toBe(2)
  })
})
