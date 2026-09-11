import { describe, expect, test } from 'vitest'
import { diffCount, lineDiff, type Row, trimmed, workDone } from './diff'

/** The diff as a patch reads, so a test says what a person would see. */
function shown(before: string, after: string): string[] {
  return lineDiff(before, after).map((row) => `${mark(row)}${row.text}`)
}

function mark(row: Row): string {
  if (row.change === 'added') return '+'
  return row.change === 'removed' ? '-' : ' '
}

describe('a line diff', () => {
  test('says nothing about two texts that are the same', () => {
    expect(shown('a\nb', 'a\nb')).toEqual([' a', ' b'])
    expect(diffCount(lineDiff('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 })
  })

  test('finds a line that changed', () => {
    expect(shown('a\nb\nc', 'a\nB\nc')).toEqual([' a', '-b', '+B', ' c'])
  })

  test('finds a line that was added', () => {
    expect(shown('a\nc', 'a\nb\nc')).toEqual([' a', '+b', ' c'])
  })

  test('finds a line that went', () => {
    expect(shown('a\nb\nc', 'a\nc')).toEqual([' a', '-b', ' c'])
  })

  test('keeps the lines both texts share in the middle', () => {
    expect(shown('a\nkeep\nb', 'x\nkeep\ny')).toEqual(['-a', '+x', ' keep', '-b', '+y'])
  })

  test('counts what it changed', () => {
    expect(diffCount(lineDiff('a\nb\nc', 'a\nB\nC\nd'))).toEqual({ added: 3, removed: 2 })
  })

  test('numbers the lines on the side that has them', () => {
    const rows = lineDiff('a\nb', 'a\nB')
    expect(rows.map((row) => [mark(row), row.before, row.after])).toEqual([
      [' ', 1, 1],
      ['-', 2, undefined],
      ['+', undefined, 2],
    ])
  })

  test('an empty text on either side is all of the other one', () => {
    expect(shown('', 'a\nb')).toEqual(['+a', '+b'])
    expect(shown('a\nb', '')).toEqual(['-a', '-b'])
    expect(shown('', '')).toEqual([])
  })

  test('a moved line reads as one taken away and one put back', () => {
    expect(shown('a\nb\nc', 'b\nc\na')).toEqual(['-a', ' b', ' c', '+a'])
  })

  /** The one thing a diff of two versions of a note must not do is take a
   *  noticeable moment over it.
   *
   *  Counted rather than timed. This asked for under 100 ms and a runner with the
   *  rest of the suite on it fails that while the diff is exactly as fast as it was:
   *  a wall clock measures the queue in front of the code as much as the code.
   *  `workDone` in diff.ts says what the diff did instead, and says the same number
   *  on a busy machine as on an idle one.
   *
   *  What it says is the reason this is quick at all. Two versions of a note are
   *  mostly the same note, so the lines they share at the top and the bottom are
   *  matched off before the table is touched and the table only ever covers what is
   *  left. The table is one cell per pair, so that is the difference between one
   *  cell and sixteen million. */
  test('two long versions of the same note are quick', () => {
    const before = Array.from({ length: 4000 }, (_, at) => `line ${at}`).join('\n')
    const after = before.replace('line 2000', 'line two thousand')

    // Whatever an earlier diff left counted, dropped, so what comes back is this
    // diff's own.
    workDone()
    const rows = lineDiff(before, after)
    const work = workDone()

    expect(diffCount(rows)).toEqual({ added: 1, removed: 1 })

    // All four thousand lines but the one that changed, matched off first: two
    // thousand at the head and one thousand nine hundred and ninety nine at the
    // tail.
    expect(work.matched).toBe(3999)
    // Which leaves one line either side, and a table of one cell. A diff that
    // stopped matching them off would fill in sixteen million.
    expect(work.cells).toBe(1)
  })

  test('two texts with nothing in common read as one replacement', () => {
    const before = Array.from({ length: 2000 }, (_, at) => `old ${at}`).join('\n')
    const after = Array.from({ length: 2000 }, (_, at) => `new ${at}`).join('\n')

    expect(diffCount(lineDiff(before, after))).toEqual({ added: 2000, removed: 2000 })
  })
})

describe('what is worth showing', () => {
  test('the changes, with a couple of lines around them', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n')

    expect(trimmed(lineDiff(before, after)).map((row) => `${mark(row)}${row.text}`)).toEqual([
      ' b',
      ' c',
      '-d',
      '+D',
      ' e',
      ' f',
    ])
  })

  test('nothing at all where nothing changed', () => {
    expect(trimmed(lineDiff('a\nb', 'a\nb'))).toEqual([])
  })
})
