import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Archive, ArchivedSpaces, DEEPEST, isTile, sameBookmark, SHALLOWEST, SpaceGraphSettings } from '../src/api'

function storage(): Storage {
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
vi.stubGlobal('localStorage', storage())
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe('what a space keeps beside its files', () => {
  test('an archived folder hides what is under it, and its mark moves with it', async () => {
    const archive = new Archive(() => '/s')
    await archive.change('/s', ['Work'], [])
    expect(archive.has('/s/Work/Plan.md')).toBe(true)
    expect(archive.has('/s/Workshop.md')).toBe(false)
    archive.moved('/s/Work', '/s/Old/Work')
    await vi.waitFor(() => expect([...archive.keysOf('/s')]).toEqual(['Old/Work']))
    archive.forget('/s')
    expect(archive.of('/s')).toEqual({})
  })
  test('a space put away is remembered until it comes back', () => {
    const spaces = new ArchivedSpaces()
    expect(spaces.set('/s', true)).toBe(true)
    expect(spaces.set('/s', true)).toBe(false)
    expect(spaces.has('/s')).toBe(true)
    spaces.set('/s', false)
    expect(spaces.has('/s')).toBe(false)
  })
  test('a bookmark is the same by kind, place and words, and a tile is a note in no group', () => {
    const plan = { kind: 'note', path: 'Plan.md', text: 'Plan' } as const
    expect(sameBookmark(plan, { ...plan })).toBe(true)
    expect(sameBookmark(plan, { ...plan, kind: 'folder' })).toBe(false)
    expect(isTile(plan)).toBe(true)
    expect(isTile({ ...plan, parent: 'g1' })).toBe(false)
  })
})
describe("a space's graph settings", () => {
  test('with no space open there is nothing to change', () => {
    const settings = new SpaceGraphSettings(() => null)
    const before = settings.here
    settings.set({ depth: DEEPEST })
    expect(settings.here).toEqual(before)
  })
  test('a depth is held between the shallowest and the deepest', () => {
    const settings = new SpaceGraphSettings(() => '/space')
    settings.set({ depth: DEEPEST + 10 })
    expect(settings.here.depth).toBe(DEEPEST)
    settings.set({ depth: 0 })
    expect(settings.here.depth).toBe(SHALLOWEST)
  })
})
