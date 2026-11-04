import { describe, expect, test } from 'vitest'
import { letterOf, lettersFor, PANE_LETTERS, takenUnderAlt, underAlt } from './letters'

const essential = (name: string) => ({ path: `/space/${name}.md`, name })
const NONE = new Set<string>()

describe("an Essential's letter", () => {
  test('is the first of its name, else the next of its name that is free', () => {
    const given = lettersFor([essential('Notes'), essential('Next'), essential('Ne')], {}, NONE)
    expect(given).toEqual({ '/space/Notes.md': 'N', '/space/Next.md': 'E', '/space/Ne.md': 'A' })
  })

  /** Emil, #1051: letters are stable, so muscle memory works. */
  test('stays where it was when another is put in front of it', () => {
    const first = lettersFor([essential('Notes')], {}, NONE)
    const after = lettersFor([essential('Nine'), essential('Notes')], first, NONE)
    expect(after['/space/Notes.md']).toBe('N')
    expect(after['/space/Nine.md']).toBe('I')
  })

  test('is never one Alt is already, nor a pane key (#1033)', () => {
    const taken = takenUnderAlt(['Alt-d', 'Mod-Alt-n', 'Alt-Shift-e', null], 'win')
    expect([...taken].sort()).toEqual([...PANE_LETTERS, 'D'].sort())
    const given = lettersFor(
      [essential('Daily'), essential('Help'), essential('Journal')],
      {},
      taken,
    )
    expect(given).toEqual({
      '/space/Daily.md': 'A',
      '/space/Help.md': 'E',
      '/space/Journal.md': 'O',
    })
  })

  test('kept from before gives way where a key has taken it since', () => {
    const given = lettersFor([essential('Draft')], { '/space/Draft.md': 'D' }, new Set(['D']))
    expect(given['/space/Draft.md']).toBe('R')
  })

  test('comes from the letters of a name written with accents or none', () => {
    const given = lettersFor([essential('Éte'), essential('2026')], {}, NONE)
    expect(given).toEqual({ '/space/Éte.md': 'E', '/space/2026.md': 'A' })
  })

  test('runs out quietly once all 26 are given', () => {
    const many = Array.from({ length: 27 }, (_, at) => essential(`n${at}`))
    expect(Object.keys(lettersFor(many, {}, NONE))).toHaveLength(26)
  })
})

describe('the letter a key is', () => {
  const stroke = { key: 'n', code: 'KeyN', altKey: true, ctrlKey: false, shiftKey: false }
  const more = { metaKey: false, altGraph: false }

  test('the one it typed, or the one at its place when Alt typed something else', () => {
    expect(letterOf({ ...stroke, ...more })).toBe('N')
    expect(letterOf({ ...stroke, ...more, key: 'Dead' })).toBe('N')
  })

  test('none without Alt, or with anything more', () => {
    expect(letterOf({ ...stroke, ...more, altKey: false })).toBeNull()
    expect(letterOf({ ...stroke, ...more, ctrlKey: true })).toBeNull()
    expect(letterOf({ ...stroke, ...more, altGraph: true })).toBeNull()
    expect(letterOf({ ...stroke, ...more, key: '3', code: 'Digit3' })).toBeNull()
  })

  test('a key bound under Alt alone is its character', () => {
    expect(underAlt('Alt-k', 'linux')).toBe('K')
    expect(underAlt('Mod-Alt-k', 'linux')).toBeNull()
  })
})
