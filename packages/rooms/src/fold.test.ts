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

/** Whether a boundary in `text` falls between the two halves of one character. */
function halved(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false

  const before = text.charCodeAt(at - 1)
  return before >= 0xd800 && before <= 0xdbff
}

/** Whether a string carries half a character of its own: a lead with no trail
 *  after it, or a trail with no lead in front. */
function halves(text: string): boolean {
  const leads = (at: number) => text.charCodeAt(at) >= 0xd800 && text.charCodeAt(at) <= 0xdbff
  const trails = (at: number) => text.charCodeAt(at) >= 0xdc00 && text.charCodeAt(at) <= 0xdfff

  for (let at = 0; at < text.length; at++) {
    if (leads(at)) {
      if (!trails(at + 1)) return true
      at++
      continue
    }

    if (trails(at)) return true
  }

  return false
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

  test('never cuts one in half at the back of the change either', () => {
    // The emoji is shared and whole, and what differs is the letter in front of
    // it: the change is that letter and nothing else. A replacement whose end
    // lands between the two halves of the emoji would put a lone half into the
    // shared text and hand another one to every other device.
    expect(fold('a👍', 'b👍')).toEqual({ from: 0, to: 1, insert: 'b' })
  })

  test('names a change whose ends are both whole characters', () => {
    const pairs: [string, string][] = [
      ['a👍', 'b👍'],
      ['👍a', '👎a'],
      ['a👍b', 'a👎b'],
      ['👍', 'a👍'],
      ['x👍👎', 'y👍👎'],
      ['👍👎', '👍a👎'],
    ]

    for (const [held, mine] of pairs) {
      const change = fold(held, mine)
      expect(change, `${held} -> ${mine}`).not.toBeNull()
      if (!change) continue

      const said = `${held} -> ${mine}`
      expect(halved(held, change.from), said).toBe(false)
      expect(halved(held, change.to), said).toBe(false)
      expect(halves(change.insert), said).toBe(false)
      expect(applied(held, mine), said).toBe(mine)
    }
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
