import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { fold } from './fold'
import { TEXT } from './wire'

/** What the fold is for: the words a device wrote while away, put into the shared
 *  text as the edit they are. */
function applied(held: string, mine: string): string {
  const doc = new Y.Doc()
  const text = doc.getText(TEXT)
  text.insert(0, held)

  const change = fold(held, mine)
  if (change) {
    doc.transact(() => {
      if (change.to > change.from) text.delete(change.from, change.to - change.from)
      if (change.insert) text.insert(change.from, change.insert)
    })
  }

  return text.toJSON()
}

describe('folding a text written while away', () => {
  test('has nothing to do when the two agree', () => {
    expect(fold('one two', 'one two')).toBeNull()
  })

  test('names only the middle that differs', () => {
    // The trailing `a` of both words is shared, so what changed is `alph` for
    // `bet` and nothing on either side of it.
    expect(fold('# Note\nalpha\nend\n', '# Note\nbeta\nend\n')).toEqual({
      from: 7,
      to: 11,
      insert: 'bet',
    })
  })

  test('names an insertion at the end', () => {
    expect(fold('one\n', 'one\ntwo\n')).toEqual({ from: 4, to: 4, insert: 'two\n' })
  })

  test('names an insertion at the start', () => {
    expect(fold('two\n', 'one\ntwo\n')).toEqual({ from: 0, to: 0, insert: 'one\n' })
  })

  test('names a deletion', () => {
    expect(fold('one\ntwo\n', 'one\n')).toEqual({ from: 4, to: 8, insert: '' })
  })

  test('never cuts a character in half', () => {
    // Two emoji that share their first code unit, so a naive trim would keep
    // half of one and half of the other.
    const change = fold('a👍b', 'a👎b')
    expect(change).not.toBeNull()
    expect(applied('a👍b', 'a👎b')).toBe('a👎b')
  })

  test('turns one text into the other, whatever the edit was', () => {
    const pairs: [string, string][] = [
      ['', 'first words\n'],
      ['first words\n', ''],
      ['aaa', 'aaaa'],
      ['aaaa', 'aaa'],
      ['# One\n\ntext\n', '# One\n\nmore text here\n\n## Two\n'],
      ['abcabc', 'abc'],
      ['line\n', 'line\nline\n'],
    ]

    for (const [held, mine] of pairs) expect(applied(held, mine), `${held} -> ${mine}`).toBe(mine)
  })
})
