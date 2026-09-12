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

/** What the index answers for a bare name, which each test sets. */
let indexed: string | null = null

/** Every path the workspace was asked to open. */
const opened: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    fileNamed: () => indexed,
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
    indexed = 'notes/Plan.md'

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
    indexed = '../../outside.md'
    opened.length = 0

    await expect(openNote({ path: 'outside' })).rejects.toThrow(/not a path inside the space/)
    expect(opened).toEqual([])
  })
})
