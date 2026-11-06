import { describe, expect, test } from 'vitest'
import { markLines } from './mark'
import { MARKS } from './mark'

describe('a coloured highlight on the panel', () => {
  const lines = (source: string, marks = MARKS) =>
    markLines(source, { inner: 560, marks }).map((one) => one.text)

  test('is the words, with the colour nowhere on the panel', () => {
    expect(lines('Be ==\u{1F534} careful== here.\n')).toEqual(['Be careful here.'])
  })

  test('keeps the marks the reader asked for, and still not the colour', () => {
    expect(lines('Be ==\u{1F534} careful== here.\n', { ...MARKS, highlight: true })).toEqual([
      'Be ==careful== here.',
    ])
  })

  test('leaves a highlight with no colour exactly as it was', () => {
    expect(lines('Be ==careful== here.\n')).toEqual(['Be careful here.'])
  })
})
