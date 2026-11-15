import { describe, expect, test } from 'vitest'
import { syntaxChanges } from './convert-syntax'

const note = (path: string, text: string) => ({ path, text })

describe('what Convert syntax would rewrite', () => {
  test('a note per note that needs one, and none for the rest', () => {
    const said = syntaxChanges(
      [note('One.md', '#two words# here'), note('Two.md', 'nothing to do here')],
      [],
    )

    expect(said.changes.map((one) => one.path)).toEqual(['One.md'])
    expect(said.changes[0]?.after).toBe('#two-words here')
    expect(said.rewrites).toBe(1)
  })

  test('and nothing at all for a space that needs nothing', () => {
    const said = syntaxChanges([note('One.md', '# Plan\n\n#work and [[Two]]\n')], ['Two.md'])

    expect(said.changes).toEqual([])
    expect(said.rewrites).toBe(0)
  })

  test('counts every rewrite rather than every note, which is what the sheet says', () => {
    const said = syntaxChanges(
      [note('One.md', '#two words# and #three more words#'), note('Two.md', '#one more#')],
      [],
    )

    expect(said.changes).toHaveLength(2)
    expect(said.rewrites).toBe(3)
  })

  test('an id link needs the space’s names, and finds the note they hold', () => {
    const said = syntaxChanges(
      [note('One.md', 'see [[202201011200]]')],
      ['202201011200 The plan.md'],
    )

    expect(said.changes[0]?.after).toBe('see [[202201011200 The plan]]')
    expect(said.rewrites).toBe(1)
  })

  test('and Roam’s own markup is rewritten in a note that arrived some other way', () => {
    const said = syntaxChanges(
      [note('One.md', '{{[[TODO]]}} Buy ^^milk^^\n\nAs ((abc123)) said.\n')],
      [],
    )

    expect(said.changes[0]?.after).toBe('- [ ] Buy ==milk==\n\nAs ((abc123)) said.\n')
    expect(said.rewrites).toBe(2)
  })

  test('every change carries the words it came from and the way back', () => {
    const said = syntaxChanges([note('One.md', '#two words# here')], [])
    const change = said.changes[0]

    expect(change?.before).toBe('#two words# here')
    expect(change?.edits.length).toBeGreaterThan(0)
    expect(change?.back.length).toBeGreaterThan(0)
  })

  test('and a rewrite that changes no character is not a change', () => {
    expect(syntaxChanges([note('One.md', '')], []).changes).toEqual([])
  })

  test('and a file that is not a note is never one to rewrite', () => {
    const said = syntaxChanges(
      [note('Board.canvas', '{"text":"#two words# here"}'), note('Team.chat', '#two words#')],
      [],
    )

    expect(said.changes).toEqual([])
    expect(said.rewrites).toBe(0)
  })
})

describe('Convert syntax beside a protected note', () => {
  test('neither rewrites nor counts what is in it while it is shut', async () => {
    const { protection } = await import('./protect/src/protection.svelte')
    const { unlocks } = await import('./protect/src/unlocked.svelte')
    protection.set('/space', '/space/Diary.md', 'password')
    try {
      const said = syntaxChanges(
        [note('/space/Diary.md', '#two words#'), note('/space/Plans.md', '#one more#')],
        [],
      )
      expect(said.changes.map((one) => one.path)).toEqual(['/space/Plans.md'])
      expect(said.rewrites).toBe(1)
    } finally {
      unlocks.lockAll()
      protection.set('/space', '/space/Diary.md', null)
    }
  })
})
