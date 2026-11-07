import { describe, expect, test } from 'vitest'
import { oneEdit } from './edits'

describe('the one edit two texts differ by', () => {
  const applied = (before: string, after: string) => {
    const edit = oneEdit(before, after)
    return edit === null ? before : before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  }

  test('is nothing at all where they do not differ', () => {
    expect(oneEdit('same', 'same')).toBeNull()
    expect(oneEdit('', '')).toBeNull()
  })

  test('is the run in the middle, with what they share on either side left out', () => {
    expect(oneEdit('one two three', 'one TWO three')).toEqual({
      from: 4,
      to: 7,
      insert: 'TWO',
    })
  })

  test('an insertion is an empty span', () => {
    expect(oneEdit('ac', 'abc')).toEqual({ from: 1, to: 1, insert: 'b' })
  })

  test('and a deletion is an empty insert', () => {
    expect(oneEdit('abc', 'ac')).toEqual({ from: 1, to: 2, insert: '' })
  })

  test('a whole text replaced says so', () => {
    expect(oneEdit('abc', 'xyz')).toEqual({ from: 0, to: 3, insert: 'xyz' })
  })

  test('always lands on the text it was asked for', () => {
    const pairs: [string, string][] = [
      ['aaa', 'aa'],
      ['aa', 'aaa'],
      ['abab', 'abcab'],
      ['', 'something'],
      ['something', ''],
      ['---\nicon: rocket\n---\n', '---\nicon: rocket\nicon-color: violet\n---\n'],
      ['{\n\t"nodes": []\n}\n', '{\n\t"nodes": [],\n\t"orden": {\n\t\t"icon": "rocket"\n\t}\n}\n'],
    ]

    for (const [before, after] of pairs) {
      expect(applied(before, after), `${before} -> ${after}`).toBe(after)
    }
  })

  test('and never overlaps itself, however alike the two texts are', () => {
    const edit = oneEdit('aaaa', 'aaa')
    expect(edit?.from).toBeLessThanOrEqual(edit?.to ?? 0)
  })
})
