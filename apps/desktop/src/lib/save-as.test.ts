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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded once, at module scope; the workspace reaches half the app. */
const { workspace } = await import('./workspace.svelte')
const { canSaveAs, isExternalFile } = await import('./save-as')

/** A note in a space is written as it is typed and synced from there, so "save it
 *  somewhere else" is not a thing to ask of it. A file opened from anywhere else on
 *  the disk is the reader's own, and that is the one Save as is about. */
describe('which files are the reader’s own', () => {
  test('nothing is, while there are no spaces to be outside of', () => {
    expect(workspace.spaces).toEqual([])
    expect(isExternalFile('C:/Users/me/notes/Plan.md')).toBe(true)
  })

  test('a note with no path at all has never been anywhere', () => {
    expect(isExternalFile(null)).toBe(false)
    expect(isExternalFile('')).toBe(false)
  })

  test('a note under a space is the space’s', () => {
    workspace.spaces.push({ id: 'one', name: 'Notes', root: 'C:/Spaces/Notes' })

    expect(isExternalFile('C:/Spaces/Notes/Plan.md')).toBe(false)
    expect(isExternalFile('C:/Elsewhere/Plan.md')).toBe(true)

    workspace.spaces.length = 0
  })
})

describe('the Save as row', () => {
  /** A browser has no path to save to and no dialog to choose one in; the row is
   *  greyed out rather than absent, so File keeps its shape. */
  test('is offered on a desktop only', () => {
    expect(canSaveAs()).toBe(false)
  })
})
