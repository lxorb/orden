import { describe, expect, test } from 'vitest'
import { conflictPath, freeName, freePath, numbered, unstacked, withoutForbidden } from './paths'

describe('stepping a name that is taken', () => {
  test('leaves the first one as it is; numbers from two, the way the app numbers a duplicate; puts the number before the extension', () => {
    expect(numbered('Idea.md', 1)).toBe('Idea.md')
    expect(numbered('Idea.md', 0)).toBe('Idea.md')
    expect(numbered('Idea.md', 2)).toBe('Idea 2.md')
    expect(numbered('Idea.md', 3)).toBe('Idea 3.md')
    expect(numbered('a/b/Idea.md', 4)).toBe('a/b/Idea 4.md')
  })

  test('leaves a folder with a dot in its name alone; treats a name that is all extension as a name', () => {
    expect(numbered('v1.2/Idea.md', 2)).toBe('v1.2/Idea 2.md')
    expect(numbered('v1.2/Note', 2)).toBe('v1.2/Note 2')
    expect(numbered('.hidden', 2)).toBe('.hidden 2')
    expect(numbered('a/.hidden', 2)).toBe('a/.hidden 2')
  })
})

describe('the first spelling nobody has', () => {
  test('is the name itself when it is free; steps until it finds one', () => {
    expect(freePath('Idea.md', () => false)).toBe('Idea.md')
    const taken = new Set(['Idea.md', 'Idea 2.md', 'Idea 3.md'])
    expect(freePath('Idea.md', (one) => taken.has(one))).toBe('Idea 4.md')
  })

  test('counts a numbered name on instead of numbering it again (#1630)', () => {
    const taken = new Set(['App.application', 'App 2.application'])
    expect(freePath('App 2.application', (one) => taken.has(one))).toBe('App 3.application')
    expect(freePath('a/App 2.application', (one) => taken.has(one.slice(2)))).toBe(
      'a/App 3.application',
    )
    expect(freeName('Work 2', (one) => one === 'Work 2')).toBe('Work 3')
  })

  test('leaves a year or a long number in a name as part of the name; asks the caller, so a caller that ignores case gets one answer', () => {
    expect(freePath('Plan 2026.md', (one) => one === 'Plan 2026.md')).toBe('Plan 2026 2.md')
    const taken = new Set(['idea.md'])
    expect(freePath('Idea.md', (one) => taken.has(one.toLowerCase()))).toBe('Idea 2.md')
  })
})

describe('a name that grew a run of numbers', () => {
  test('is the name it grew from (#1630); leaves one number, or numbers that are not a run, alone', () => {
    expect(unstacked('AbaClient Manager 2 2 2 2 2 2 2.application')).toBe(
      'AbaClient Manager.application',
    )
    expect(unstacked('a/b/Notes 2 2')).toBe('a/b/Notes')
    expect(unstacked('Plan 2.md')).toBe('Plan 2.md')
    expect(unstacked('Plan 3 2.md')).toBe('Plan 3 2.md')
    expect(unstacked('2 2.md')).toBe('2 2.md')
  })
})

describe('what a file may not hold', () => {
  test('becomes a space, so the name is still a name; takes the control characters a pasted title carries; leaves everything a file may hold', () => {
    expect(withoutForbidden('Plans: 2026')).toBe('Plans  2026')
    expect(withoutForbidden('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
    expect(withoutForbidden('one\ntwo\tthree ')).toBe('one two three ')
    expect(withoutForbidden("Plans & more (2026) - Emil's")).toBe("Plans & more (2026) - Emil's")
  })
})

describe('where the other copy goes', () => {
  test('is beside the note, saying where it came from and when; keeps the extension whatever it is', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(conflictPath('Plans/Trip.md')).toBe(`Plans/Trip (from another device ${today}).md`)
    expect(conflictPath('Board.canvas')).toContain('.canvas')
  })

  test('and a file with no extension still gets a name of its own', () => {
    const on = new Date('2026-09-13T10:00:00Z')

    expect(conflictPath('Notes', on)).toBe('Notes (from another device 2026-09-13)')
    expect(conflictPath('notes/README', on)).toBe('notes/README (from another device 2026-09-13)')
    expect(conflictPath('v1.2/README', on)).toBe('v1.2/README (from another device 2026-09-13)')
    expect(conflictPath('C:\\v1.2\\README', on)).toBe(
      'C:\\v1.2\\README (from another device 2026-09-13)',
    )
  })

  test('is never the file it is a copy of; steps aside by number when that name is taken too', () => {
    for (const path of ['README', 'a/README', 'trailing.', '.hidden', 'a.b/c', 'a/.md', 'a.md']) {
      expect(conflictPath(path)).not.toBe(path)
    }
    const beside = conflictPath('Plan.md', new Date('2026-09-13T10:00:00Z'))
    expect(beside).toBe('Plan (from another device 2026-09-13).md')
    expect(numbered(beside, 2)).toBe('Plan (from another device 2026-09-13) 2.md')
  })
})
