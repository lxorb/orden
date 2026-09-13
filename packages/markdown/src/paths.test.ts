import { describe, expect, test } from 'vitest'
import { conflictPath, freePath, numbered, withoutForbidden } from './paths'

describe('stepping a name that is taken', () => {
  test('leaves the first one as it is', () => {
    expect(numbered('Idea.md', 1)).toBe('Idea.md')
    expect(numbered('Idea.md', 0)).toBe('Idea.md')
  })

  test('numbers from two, the way the app numbers a duplicate', () => {
    expect(numbered('Idea.md', 2)).toBe('Idea 2.md')
    expect(numbered('Idea.md', 3)).toBe('Idea 3.md')
  })

  test('puts the number before the extension', () => {
    expect(numbered('a/b/Idea.md', 4)).toBe('a/b/Idea 4.md')
  })

  test('leaves a folder with a dot in its name alone', () => {
    // The import's own copy of this counted the last dot of the whole path, so a
    // note with no extension under such a folder stepped aside into a folder
    // nobody had: `v1 2.2/Note`.
    expect(numbered('v1.2/Idea.md', 2)).toBe('v1.2/Idea 2.md')
    expect(numbered('v1.2/Note', 2)).toBe('v1.2/Note 2')
  })

  test('treats a name that is all extension as a name', () => {
    expect(numbered('.hidden', 2)).toBe('.hidden 2')
    expect(numbered('a/.hidden', 2)).toBe('a/.hidden 2')
  })
})

describe('the first spelling nobody has', () => {
  test('is the name itself when it is free', () => {
    expect(freePath('Idea.md', () => false)).toBe('Idea.md')
  })

  test('steps until it finds one', () => {
    const taken = new Set(['Idea.md', 'Idea 2.md', 'Idea 3.md'])
    expect(freePath('Idea.md', (one) => taken.has(one))).toBe('Idea 4.md')
  })

  test('asks the caller, so a caller that ignores case gets one answer', () => {
    const taken = new Set(['idea.md'])
    expect(freePath('Idea.md', (one) => taken.has(one.toLowerCase()))).toBe('Idea 2.md')
  })
})

describe('what a file may not hold', () => {
  test('becomes a space, so the name is still a name', () => {
    expect(withoutForbidden('Plans: 2026')).toBe('Plans  2026')
    expect(withoutForbidden('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
  })

  test('takes the control characters a pasted title carries', () => {
    expect(withoutForbidden('one\ntwo\tthree ')).toBe('one two three ')
  })

  test('leaves everything a file may hold', () => {
    expect(withoutForbidden("Plans & more (2026) - Emil's")).toBe("Plans & more (2026) - Emil's")
  })
})

describe('where the other copy goes', () => {
  test('is beside the note, saying where it came from and when', () => {
    const today = new Date().toISOString().slice(0, 10)

    expect(conflictPath('Plans/Trip.md')).toBe(`Plans/Trip (from another device ${today}).md`)
  })

  test('keeps the extension whatever it is', () => {
    expect(conflictPath('Board.canvas')).toContain('.canvas')
  })

  test('and a file with no extension is still a name', () => {
    expect(conflictPath('Notes')).toBe('Notes')
  })

  test('steps aside by number when that name is taken too', () => {
    // Two copies of one note in one day: the same rule every other taken name
    // goes through. The service walks these in order; see `noteBeside` in
    // services/sync/src/notes.ts.
    const beside = conflictPath('Plan.md', new Date('2026-09-13T10:00:00Z'))

    expect(beside).toBe('Plan (from another device 2026-09-13).md')
    expect(numbered(beside, 2)).toBe('Plan (from another device 2026-09-13) 2.md')
  })
})
