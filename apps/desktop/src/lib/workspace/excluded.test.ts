import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Excluded, excludedPaths, MOST_EXCLUDED, STORAGE_KEY } from './excluded.svelte'

/** The notes and folders a space leaves out of what it says about itself.
 *
 *  A list of paths kept beside the space, so the same obligations the folder icons
 *  have: read what storage answers rather than trust it, re-key when a note or a
 *  folder moves, forget a path that has gone, and let the account's copy win after
 *  first contact. A folder standing for everything under it is the rule most of
 *  these are about.
 *
 *  Nothing is pushed anywhere under node: the push imports the account and the
 *  syncing loop, both of which answer with nothing signed out. */

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

const ROOT = '/space'
const at = (relative: string) => `${ROOT}/${relative}`

let excluded: Excluded

beforeEach(() => {
  localStorage.clear()
  excluded = new Excluded(() => ROOT)
})

describe('leaving a path out', () => {
  test('is kept as the space speaks of it, not as this disk does', () => {
    excluded.toggle(at('Archive'))

    expect(excluded.of(ROOT)).toEqual(['Archive'])
  })

  test('and is asked by either path', () => {
    excluded.toggle(at('Archive'))

    expect(excluded.has(at('Archive'))).toBe(true)
    expect(excluded.has('Archive')).toBe(true)
  })

  test('and a folder stands for everything under it', () => {
    excluded.toggle(at('Archive'))

    expect(excluded.has(at('Archive/Old plan.md'))).toBe(true)
    expect(excluded.has(at('Archive/2025/Older.md'))).toBe(true)
    // And nothing merely spelled like it.
    expect(excluded.has(at('Archived.md'))).toBe(false)
  })

  test('and the same path again takes it back', () => {
    excluded.toggle(at('Archive'))
    excluded.toggle(at('Archive'))

    expect(excluded.of(ROOT)).toEqual([])
  })

  test('and a note inside a folder already left out says nothing more', () => {
    excluded.toggle(at('Archive'))
    excluded.toggle(at('Archive/Old plan.md'))

    expect(excluded.of(ROOT)).toEqual(['Archive'])
  })

  /** Which is what `names` is for: only the row that can be taken back is offered
   *  the words to take it back with. */
  test('and only the path itself is the one that can be taken back', () => {
    excluded.toggle(at('Archive'))

    expect(excluded.names(at('Archive'))).toBe(true)
    expect(excluded.names(at('Archive/Old plan.md'))).toBe(false)
  })

  test('and a folder left out takes over from the notes inside it', () => {
    excluded.toggle(at('Archive/Old plan.md'))
    excluded.toggle(at('Archive/2025/Older.md'))
    excluded.toggle(at('Archive'))

    expect(excluded.of(ROOT)).toEqual(['Archive'])
  })

  test('and a path that climbs out of the space is not one to leave out', () => {
    excluded.toggle('/elsewhere/Note.md')

    expect(excluded.of(ROOT)).toEqual([])
  })

  test('and there is a ceiling, which is the service s ceiling', () => {
    for (let one = 0; one <= MOST_EXCLUDED + 5; one++) excluded.toggle(at(`note-${one}.md`))

    expect(excluded.of(ROOT)).toHaveLength(MOST_EXCLUDED)
  })

  test('and it survives being read again, which is another window', () => {
    excluded.toggle(at('Archive'))

    expect(new Excluded(() => ROOT).has(at('Archive/Old.md'))).toBe(true)
  })
})

describe('a path that moves or goes', () => {
  test('takes its exclusion with it, and everything under it', () => {
    excluded.toggle(at('Archive'))
    excluded.moved(at('Archive'), at('Old/Archive'))

    expect(excluded.of(ROOT)).toEqual(['Old/Archive'])
    expect(excluded.has(at('Old/Archive/Note.md'))).toBe(true)
  })

  test('and a note moved inside a folder that moved is re-keyed once', () => {
    excluded.toggle(at('Work/Old plan.md'))
    excluded.moved(at('Work'), at('Archive'))

    expect(excluded.of(ROOT)).toEqual(['Archive/Old plan.md'])
  })

  test('and a path that has gone is forgotten', () => {
    excluded.toggle(at('Archive/Old.md'))
    excluded.gone(at('Archive'))

    expect(excluded.of(ROOT)).toEqual([])
  })
})

describe('the space folder itself moving', () => {
  test('takes the list with it, since it is kept under its path', () => {
    excluded.toggle(at('Archive'))
    excluded.spaceMoved(ROOT, '/moved')

    expect(excluded.of('/moved')).toEqual(['Archive'])
    expect(excluded.of(ROOT)).toEqual([])
  })

  test('and a space that has gone is forgotten', () => {
    excluded.toggle(at('Archive'))
    excluded.forget(ROOT)

    expect(excluded.here).toEqual([])
  })
})

describe('reading what storage answers with', () => {
  test('keeps the paths and leaves the rest', () => {
    expect(excludedPaths(['Archive', { glob: '*.tmp' }, 7, '', 'Work'])).toEqual([
      'Archive',
      'Work',
    ])
  })

  test('and each path once', () => {
    expect(excludedPaths(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  test('and answers with nothing at all for what is not a list', () => {
    expect(excludedPaths(null)).toEqual([])
    expect(excludedPaths('Archive')).toEqual([])
    expect(excludedPaths({ 0: 'Archive' })).toEqual([])
  })

  test('and a store written by hand cannot leave the space', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [ROOT]: { paths: ['../outside'] } }))

    expect(new Excluded(() => ROOT).here).toEqual([])
  })
})

/** Which copy wins: this machine's folded in the first time an account meets the
 *  space, and the account's outright on every pass after that. */
describe('what the account holds', () => {
  test('is taken on outright once the space has been met', () => {
    excluded.adopt(ROOT, ['Archive'], 'u1')
    expect(excluded.of(ROOT)).toEqual(['Archive'])

    excluded.adopt(ROOT, ['Work'], 'u1')
    expect(excluded.of(ROOT)).toEqual(['Work'])
  })

  test('and this machine s own are folded in the first time', () => {
    excluded.toggle(at('Mine'))
    excluded.adopt(ROOT, ['Theirs'], 'u1')

    expect(excluded.of(ROOT)).toEqual(['Theirs', 'Mine'])
  })

  test('and a service too old to know about the list takes nothing away', () => {
    excluded.toggle(at('Mine'))
    excluded.adopt(ROOT, undefined, 'u1')

    expect(excluded.of(ROOT)).toEqual(['Mine'])
  })

  test('and another account signing in on this machine folds again', () => {
    excluded.adopt(ROOT, ['Theirs'], 'u1')
    excluded.toggle(at('Mine'))
    excluded.adopt(ROOT, [], 'u2')

    expect(excluded.of(ROOT)).toContain('Mine')
  })
})
