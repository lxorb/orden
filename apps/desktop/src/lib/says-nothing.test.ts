import { describe, expect, test } from 'vitest'
import { saysNothing, scanNote } from './scan-note'

/** #1042. The same cases as `a_note_that_says_nothing_yet_is_bare` in links.rs, whose
 *  twin this is: the first scan is the crate's, and a saved note is read again here. */
describe('a note that says nothing yet', () => {
  test('is whitespace, or its own name as its heading, under any front matter', () => {
    expect(saysNothing('', 'Plan')).toBe(true)
    expect(saysNothing('  \n\n\t\n', 'Plan')).toBe(true)
    expect(saysNothing('# Plan\n\n', 'Plan')).toBe(true)
    expect(saysNothing('## Plan ##\r\n\r\n', 'Plan')).toBe(true)
    expect(saysNothing('# Q1: costs\n', 'Q1 costs')).toBe(true)
    expect(saysNothing('---\nicon: rocket\ntitle: Plan\n---\n\n', 'Plan')).toBe(true)
    expect(saysNothing('---\ntitle: Plan\n---\n# Plan\n', 'Plan')).toBe(true)
  })

  test('and anything more is a note with something in it', () => {
    expect(saysNothing('# Plan\n\nWords.\n', 'Plan')).toBe(false)
    expect(saysNothing('# Another\n', 'Plan')).toBe(false)
    expect(saysNothing('Plan\n', 'Plan')).toBe(false)
    expect(saysNothing('# Plan\n- [ ] task\n', 'Plan')).toBe(false)
    expect(saysNothing('#Plan\n', 'Plan')).toBe(false)
  })

  test('is read on the scan the index makes of every note, under the file s name', () => {
    expect(scanNote('Trips/Plan.md', '# Plan\n').bare).toBe(true)
    expect(scanNote('Trips/Plan.md', '# Plan\nWords\n').bare).toBe(false)
  })
})
