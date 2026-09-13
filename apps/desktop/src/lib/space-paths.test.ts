import { describe, expect, test } from 'vitest'
import {
  folderOf,
  insideAnyOf,
  insideItsSpace,
  nameOf,
  noteName,
  relativePath,
  relativeTo,
} from './space-paths'

describe('a path as the space speaks of it', () => {
  test('drops the root and the platform separators', () => {
    expect(relativeTo('C:\\Notes\\Work', 'C:\\Notes\\Work\\ideas\\Plan.md')).toBe('ideas/Plan.md')
    expect(relativeTo('/notes/work', '/notes/work/ideas/Plan.md')).toBe('ideas/Plan.md')
  })

  test('a path that is not under the root keeps its own shape', () => {
    expect(relativeTo('/notes', '/elsewhere/Plan.md')).toBe('/elsewhere/Plan.md')
  })

  test('names and folders come apart', () => {
    expect(folderOf('ideas/deep/Plan.md')).toBe('ideas/deep')
    expect(folderOf('Plan.md')).toBe('')
    expect(nameOf('ideas/Plan.md')).toBe('Plan.md')
    expect(noteName('ideas/Plan.md')).toBe('Plan')
    expect(noteName('ideas/Plan.markdown')).toBe('Plan')
    expect(noteName('ideas/notes.txt')).toBe('notes.txt')
  })

  /** The same pair serves a path on disk, which is the whole reason there is one
   *  pair: the tree, the undo stack, the trash and the icons all hold the path the
   *  platform wrote, and eight modules had each worked out how to split it. */
  test('the same pair splits a path the platform wrote', () => {
    expect(folderOf('C:\\Notes\\ideas\\Plan.md')).toBe('C:\\Notes\\ideas')
    expect(nameOf('C:\\Notes\\ideas\\Plan.md')).toBe('Plan.md')
    expect(folderOf('/notes/ideas/Plan.md')).toBe('/notes/ideas')
    expect(nameOf('/notes/ideas/Plan.md')).toBe('Plan.md')
  })

  test('a name with no path at all sits at the top', () => {
    expect(folderOf('Plan.md')).toBe('')
    expect(nameOf('Plan.md')).toBe('Plan.md')
    expect(folderOf('/Plan.md')).toBe('')
    expect(nameOf('/Plan.md')).toBe('Plan.md')
  })

  test('a folder is split like anything else, trailing separator and all', () => {
    expect(folderOf('ideas/deep')).toBe('ideas')
    expect(nameOf('ideas/deep')).toBe('deep')
    // A path written with the separator on the end names nothing; the folder it
    // sits in is still the folder it sits in. No caller writes one.
    expect(folderOf('ideas/deep/')).toBe('ideas/deep')
    expect(nameOf('ideas/deep/')).toBe('')
  })
})

describe('how a markdown link writes its way to a note', () => {
  test('a note in the same folder is named on its own', () => {
    expect(relativePath('ideas', 'ideas/Plan.md')).toBe('Plan.md')
    expect(relativePath('', 'Plan.md')).toBe('Plan.md')
  })

  test('a note deeper down is reached through its folders', () => {
    expect(relativePath('', 'ideas/deep/Plan.md')).toBe('ideas/deep/Plan.md')
    expect(relativePath('ideas', 'ideas/deep/Plan.md')).toBe('deep/Plan.md')
  })

  test('a note above is reached by climbing', () => {
    expect(relativePath('ideas/deep', 'Plan.md')).toBe('../../Plan.md')
    expect(relativePath('ideas/deep', 'ideas/Plan.md')).toBe('../Plan.md')
  })

  test('a note in a sibling folder climbs and descends', () => {
    expect(relativePath('ideas', 'later/Plan.md')).toBe('../later/Plan.md')
  })
})

/** A path that arrived from outside the app. The phone's widget hands one back
 *  from an exported activity, so anything on the device can send one. */
describe('an absolute path from somewhere else', () => {
  const windows = ['C:', 'Notes', 'Home'].join('\\')
  const roots = ['/notes/work', windows]

  test('is a path when it is inside a space, in either platform’s writing', () => {
    expect(insideAnyOf(roots, '/notes/work/ideas/Plan.md')).toBe('/notes/work/ideas/Plan.md')
    expect(insideAnyOf(roots, `${windows}\\Plan.md`)).toBe(`${windows}\\Plan.md`)
  })

  test('and nothing at all when it is inside none of them', () => {
    expect(insideAnyOf(roots, '/etc/passwd')).toBeNull()
    expect(insideAnyOf(roots, '/data/data/com.nib.app/databases/notes.db')).toBeNull()
    expect(insideAnyOf([], '/notes/work/Plan.md')).toBeNull()
  })

  test('a root is a whole folder, not the letters it starts with', () => {
    expect(insideAnyOf(roots, '/notes/work-elsewhere/Plan.md')).toBeNull()
    expect(insideAnyOf(roots, '/notes/work')).toBeNull()
  })

  test('and the way out of a space is the way out of this', () => {
    // The same judgement a link gets, so one road cannot have a hole the other
    // does not; see automation/inside.ts.
    expect(insideAnyOf(roots, '/notes/work/../../etc/passwd')).toBeNull()
    expect(insideAnyOf(roots, '/notes/work/ideas/../../../Plan.md')).toBeNull()
    expect(insideAnyOf(roots, `/notes/work/${String.fromCharCode(0)}.md`)).toBeNull()
  })

  test('what comes back is built from the root, not from what arrived', () => {
    expect(insideAnyOf(roots, '/notes/work//ideas/./Plan.md')).toBe('/notes/work/ideas/Plan.md')
    expect(insideAnyOf(roots, '  /notes/work/Plan.md  ')).toBe('/notes/work/Plan.md')
  })
})

/** What a store keyed by path will keep, which is the same reading the service
 *  does; see `staysInside` in services/sync/src/spaces/paths.ts. A column the
 *  service takes is a column this app resolves against a folder, so the two answer
 *  alike or a path arrives that cannot be resolved. */
describe('a path a store may keep', () => {
  test('is one inside the space it belongs to', () => {
    expect(insideItsSpace('Read me.md')).toBe(true)
    expect(insideItsSpace('a/b/Read me.md')).toBe(true)
  })

  test('and never one that starts at the root of somebody’s disk', () => {
    for (const path of ['/etc/passwd', 'C:/Windows/x.pdf', 'c:/x.pdf', 'C:\\Windows\\x.pdf']) {
      expect(insideItsSpace(path), path).toBe(false)
    }
  })

  test('nor one that climbs out of it, or is nothing, or is two names', () => {
    expect(insideItsSpace('../out.md')).toBe(false)
    expect(insideItsSpace('a/../../out.md')).toBe(false)
    expect(insideItsSpace('')).toBe(false)
    expect(insideItsSpace('a\nb.md')).toBe(false)
  })
})
