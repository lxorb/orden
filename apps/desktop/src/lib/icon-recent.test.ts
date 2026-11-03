import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EMOJI_SET, LUCIDE } from './icons'
import { FLAT_COLOUR, tabNamed } from './icon-sets'

/** The tab the picker was left on, across a launch. Each test reads the store as a
 *  launch would, from what storage holds. */

const store = new Map<string, string>()

vi.stubGlobal('localStorage', {
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
} satisfies Storage)

const launch = async () => {
  vi.resetModules()
  return (await import('./icon-recent.svelte')).iconRecent
}

beforeEach(() => store.clear())

describe('the tab the picker was left on', () => {
  /** It was written as the id and read back as JSON, which an id is not, so every
   *  launch opened on the line icons whatever tab had been left open. */
  test('is the one it opens on after a launch', async () => {
    ;(await launch()).open(EMOJI_SET)
    expect((await launch()).set).toBe(EMOJI_SET)
  })

  test('is read whether it was written plain or quoted', async () => {
    store.set('nib:icon-set', JSON.stringify(LUCIDE))
    expect((await launch()).set).toBe(LUCIDE)
  })

  /** "Colour" was a tab of its own before it joined the emoji (#1071). */
  test('a stored "Colour" opens the tab the drawings are in now', async () => {
    store.set('nib:icon-set', FLAT_COLOUR)
    expect(tabNamed((await launch()).set)?.id).toBe(EMOJI_SET)
  })

  test('and nothing stored is nothing, which the picker reads as its default', async () => {
    expect((await launch()).set).toBe('')
  })
})
