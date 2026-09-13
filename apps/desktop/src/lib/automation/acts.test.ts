/** Opening a note by the name a link wrote, and where the judging happens.
 *
 *  `nib://open?path=Plan` names no path: it names a note, and the app's own file
 *  index answers with the path it holds under. That answer is a path like any
 *  other by the time it reaches `insideSpace`, so it goes through the judge too -
 *  resolve first, then judge, in that order and in one place, so a caller that
 *  hands a name and a caller that hands a path cannot come to different ends. */

import { describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const space = { id: 'work', name: 'Work', root: '/Work' }

/** What the index answers for a bare name, which each test sets.
 *
 *  `named` is what the note resolver answers - the road a `[[wikilink]]` takes -
 *  and `beside` is what the list of files beside the notes answers. They are two
 *  different questions and the index keeps them apart: a note is in `notes` and a
 *  picture is in `files`, so asking the file list for a note is asking the wrong
 *  half and always answers nothing. */
let named: string | null = null
let beside: string | null = null

/** The scan in flight, and how many times it was waited for. */
let scanning: Promise<void> = Promise.resolve()
let scans = 0

/** Every path the workspace was asked to open. */
const opened: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    fileNamed: () => beside,
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target.includes('/') ? null : named,
    // The scan the index does off the launch's critical path. A link that starts
    // the app is followed while it is still in flight, so what it answers before
    // it lands is nothing at all.
    scanned: () => {
      scans += 1
      return scanning
    },
    outgoing: () => [],
    backlinks: () => [],
  },
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [space],
    activeSpace: space,
    activeSpaceId: space.id,
    active: null,
    files: [],
    tabs: [{ path: '/Work/notes/Plan.md' }],
    flush: () => undefined,
    showSpace: () => Promise.resolve(),
    openEntry: (path: string) => {
      opened.push(path)
      return Promise.resolve()
    },
  },
}))

const { openNote } = await import('./acts')

describe('a note named rather than pathed', () => {
  test('is opened at the path the index holds it under', async () => {
    named = 'notes/Plan.md'

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  test('and an index answer no space would take is refused like any other path', async () => {
    // Nothing in the app writes such a row, which is exactly why the judge is
    // here: the index is a map somebody's own notes filled in, and a caller of
    // this that skipped the judge because the index answered would be a hole
    // somewhere nobody is looking.
    named = '../../outside.md'
    opened.length = 0

    await expect(openNote({ path: 'outside' })).rejects.toThrow(/not a path inside the space/)
    expect(opened).toEqual([])
  })

  /** The index keeps notes and the files beside them apart, and a name is looked
   *  up among the notes: `nib://open?path=Plan` is documented as finding the note
   *  the way a `[[wikilink]]` does. It used to ask the file list, which holds the
   *  pictures and the PDFs and never a note, so the answer was always nothing and
   *  every link written by hand with a name in it said it could not be followed.
   *  A path was never affected, which is why it went unseen. */
  test('asks the notes rather than the files beside them', async () => {
    named = 'notes/Plan.md'
    beside = null
    opened.length = 0

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  /** The index is built off the launch's critical path, so a link that starts the
   *  app is followed while the scan is still in flight. Asking it then is asking an
   *  empty index: the note is there, the name is right, and the answer is nothing.
   *  So the name waits for the scan, which answers at once when none is running. */
  test('waits for the scan the launch started before asking it anything', async () => {
    named = null
    opened.length = 0
    scans = 0
    scanning = new Promise((landed) => {
      setTimeout(() => {
        named = 'notes/Plan.md'
        landed()
      }, 20)
    })

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(scans).toBe(1)
    expect(opened).toEqual(['/Work/notes/Plan.md'])

    scanning = Promise.resolve()
  })

  test('and a path is taken as written, whatever the index would say about it', async () => {
    named = 'notes/Somewhere else.md'
    opened.length = 0

    expect(await openNote({ path: 'notes/Plan.md' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })
})
