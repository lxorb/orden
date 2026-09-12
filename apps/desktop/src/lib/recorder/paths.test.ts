import { describe, expect, test } from 'vitest'
import { spaceRelative } from './paths'

/** The arithmetic between what `save_asset` answers - a path from the note's own
 *  folder - and what the link index speaks in, which is a path from the space's root.
 *  A segment out either way is an embed that resolves to nothing, with no error
 *  anywhere to say so. */
describe('where a recording sits in the space', () => {
  test('for a note at the top of the space', () => {
    expect(spaceRelative('/notes', '/notes/Plan.md', 'assets/take.weba')).toBe('assets/take.weba')
  })

  /** The space setting writes `../assets/x` for a note a folder down, so that every
   *  note in the space shares one assets folder. */
  test('for a note in a folder, pointing back up at the space assets folder', () => {
    expect(spaceRelative('/notes', '/notes/Work/Plan.md', '../assets/take.weba')).toBe(
      'assets/take.weba',
    )
    expect(spaceRelative('/notes', '/notes/a/b/Plan.md', '../../assets/take.weba')).toBe(
      'assets/take.weba',
    )
  })

  /** Beside the note, which is what the other two Attachments settings write. */
  test('for a file written beside the note itself', () => {
    expect(spaceRelative('/notes', '/notes/Work/Plan.md', 'take.weba')).toBe('Work/take.weba')
    expect(spaceRelative('/notes', '/notes/Work/Plan.md', 'Plan/take.weba')).toBe(
      'Work/Plan/take.weba',
    )
  })

  test('and on Windows, where the paths are written the other way', () => {
    expect(spaceRelative('C:\\notes', 'C:\\notes\\Work\\Plan.md', '../assets/take.weba')).toBe(
      'assets/take.weba',
    )
  })

  /** A path that climbs out of the space. The command that writes the file refuses one
   *  anyway; answering null rather than a path outside the root keeps this from being
   *  the one place that disagrees. */
  test('is nothing for a path that leaves the space', () => {
    expect(spaceRelative('/notes', '/notes/Plan.md', '../assets/take.weba')).toBeNull()
  })

  test('and nothing for a note that is not in the space at all', () => {
    expect(spaceRelative('/notes', '/elsewhere/Plan.md', 'assets/take.weba')).toBeNull()
  })

  test('with the odd segment that says nothing skipped', () => {
    expect(spaceRelative('/notes', '/notes/Plan.md', './assets//take.weba')).toBe(
      'assets/take.weba',
    )
  })
})
