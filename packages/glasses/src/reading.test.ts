import { describe, expect, test } from 'vitest'
import {
  type Compaction,
  COMPACTIONS,
  DEFAULT_COMPACTION,
  markLines,
  MARKS,
  type Marks,
} from './mark'
import { BODY_INNER } from './panel'

describe('compaction', () => {
  const rows = (source: string, compaction: Compaction) =>
    markLines(source, { inner: BODY_INNER, compaction }).map((one) => [one.at, one.text])

  const A_B = 'A\nB\n'
  const A_GAP_B = 'A\n\nB\n'
  const A_GAPS_B = 'A\n\n\n\nB\n'

  test('aggressive joins A, newline, B into one line, which is what it always did', () => {
    expect(rows(A_B, 'aggressive')).toEqual([[1, 'A B']])
    expect(rows(A_GAP_B, 'aggressive')).toEqual([
      [1, 'A'],
      [3, 'B'],
    ])
    expect(rows(A_GAPS_B, 'aggressive')).toEqual([
      [1, 'A'],
      [5, 'B'],
    ])
  })

  test('is what a note is set at with nobody having chosen', () => {
    expect(DEFAULT_COMPACTION).toBe('collapse')
    expect(markLines(A_B, { inner: BODY_INNER }).map((one) => one.text)).toEqual(['A', 'B'])
  })

  test('collapse keeps A, newline, B as two lines', () => {
    expect(rows(A_B, 'collapse')).toEqual([
      [1, 'A'],
      [2, 'B'],
    ])
  })

  test('and folds any run of blank lines into one break', () => {
    expect(rows(A_GAP_B, 'collapse')).toEqual([
      [1, 'A'],
      [3, 'B'],
    ])
    expect(rows(A_GAPS_B, 'collapse')).toEqual([
      [1, 'A'],
      [5, 'B'],
    ])
  })

  test('none shows every line break as written, even three in a row', () => {
    expect(rows(A_B, 'none')).toEqual([
      [1, 'A'],
      [2, 'B'],
    ])
    expect(rows(A_GAP_B, 'none')).toEqual([
      [1, 'A'],
      [2, ''],
      [3, 'B'],
    ])
    expect(rows(A_GAPS_B, 'none')).toEqual([
      [1, 'A'],
      [2, ''],
      [3, ''],
      [4, ''],
      [5, 'B'],
    ])
  })

  test('numbers the source lines whatever the level', () => {
    const source = 'one\ntwo\nthree\n\nfour\n'
    for (const level of COMPACTIONS) {
      const four = rows(source, level).find((row) => String(row[1]).endsWith('four'))
      expect(four?.[0], level).toBe(5)
    }
  })
})

describe('the markers a reader may turn on', () => {
  const shown = (source: string, over: Partial<Marks>) =>
    markLines(source, { inner: BODY_INNER, marks: { ...MARKS, ...over } })
      .map((one) => one.text)
      .join('\n')

  const TICKS = '`'
  const fenced = [`${TICKS.repeat(3)}js`, 'const a = 1', TICKS.repeat(3), ''].join('\n')
  const DRAWN = '‘‘‘'

  test('are off for everything that only styles words, which is the default', () => {
    expect(shown('a **bold** *italic* ~~struck~~ ==lit== word', {})).toBe(
      'a bold italic struck lit word',
    )
  })

  test('and on for each of them on its own', () => {
    expect(shown('a **bold** word', { bold: true })).toBe('a **bold** word')
    expect(shown('an *italic* word', { italic: true })).toBe('an *italic* word')
    expect(shown('a ~~struck~~ word', { strike: true })).toBe('a ~~struck~~ word')
    expect(shown('a ==lit== word', { highlight: true })).toBe('a ==lit== word')
  })

  test('keep inline code marked unless the reader says otherwise', () => {
    expect(shown(`run ${TICKS}orden${TICKS} now`, {})).toBe('run ‘orden‘ now')
    expect(shown(`run ${TICKS}orden${TICKS} now`, { code: false })).toBe('run orden now')
  })

  test('keep a fence marked unless the reader says otherwise', () => {
    expect(shown(fenced, {})).toBe(`${DRAWN}js\nconst a = 1\n${DRAWN}`)
    expect(shown(fenced, { fence: false })).toBe('const a = 1')
  })

  test('write a heading with its hashes only when asked', () => {
    expect(shown('## A section\n', {})).toBe(`A SECTION\n${'─'.repeat(28)}`)
    expect(shown('## A section\n', { heading: true })).toBe(`## A SECTION\n${'─'.repeat(28)}`)
  })

  test('write a link as markdown only when asked', () => {
    expect(shown('see [the notes](https://orden.so)', {})).toBe('see the notes')
    expect(shown('see [the notes](https://orden.so)', { link: true })).toBe(
      'see [the notes](https://orden.so)',
    )
  })
})
