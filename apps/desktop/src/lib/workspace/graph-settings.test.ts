import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_GRAPH,
  graphSettingsOf,
  MOST_GROUPS,
  sameGraph,
  SpaceGraphSettings,
  STORAGE_KEY,
} from './graph-settings.svelte'

/** How a space says its graph is drawn.
 *
 *  Kept beside the space rather than in a note, because none of it is something a
 *  note could say: what the picture is filtered to is about the space's notes
 *  together. So the same obligations the folder icons have - read what storage
 *  answers rather than trust it, re-key when the space folder moves, forget a space
 *  that has gone - and the account's copy winning after first contact.
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

let graph: SpaceGraphSettings

beforeEach(() => {
  localStorage.clear()
  graph = new SpaceGraphSettings(() => ROOT)
})

describe('what a space says about its graph', () => {
  test('starts as the defaults, which is a picture of everything', () => {
    expect(graph.here).toEqual(DEFAULT_GRAPH)
    expect(graph.here.filter).toBe('')
    expect(graph.here.orphans).toBe(true)
    expect(graph.here.depth).toBe(1)
  })

  test('changes what is named and leaves the rest', () => {
    graph.set({ filter: 'tag:work' })
    graph.set({ arrows: true })

    expect(graph.here.filter).toBe('tag:work')
    expect(graph.here.arrows).toBe(true)
    expect(graph.here.orphans).toBe(true)
  })

  test('holds a spread and a depth to what the card offers', () => {
    graph.set({ spread: 99, depth: 9 })

    expect(graph.here.spread).toBe(4)
    expect(graph.here.depth).toBe(3)
  })

  test('takes at most one colour group per colour the theme names', () => {
    const many = Array.from({ length: MOST_GROUPS + 3 }, (_one, index) => ({
      query: `tag:t${index}`,
      colour: 1,
    }))
    graph.set({ groups: many })

    expect(graph.here.groups).toHaveLength(MOST_GROUPS)
  })

  /** The row the card has just added: it colours nothing yet, and a store that
   *  dropped it would be a row nothing could be typed into. */
  test('and keeps a group with nothing typed in it yet', () => {
    graph.set({ groups: [{ query: '', colour: 3 }] })

    expect(graph.here.groups).toEqual([{ query: '', colour: 3 }])
  })

  test('goes back to the defaults when reset', () => {
    graph.set({ filter: 'plan', orphans: false, arrows: true, spread: 2 })
    graph.reset()

    expect(graph.here).toEqual(DEFAULT_GRAPH)
  })

  test('and survives being read again, which is another window', () => {
    graph.set({ filter: 'tag:work', depth: 3 })

    const again = new SpaceGraphSettings(() => ROOT)
    expect(again.here.filter).toBe('tag:work')
    expect(again.here.depth).toBe(3)
  })
})

describe('reading what storage answers with', () => {
  test('leaves whatever does not read as a setting at its default', () => {
    expect(graphSettingsOf({ filter: 7, orphans: 'yes', depth: null })).toEqual(DEFAULT_GRAPH)
    expect(graphSettingsOf(null)).toEqual(DEFAULT_GRAPH)
    expect(graphSettingsOf('all of it')).toEqual(DEFAULT_GRAPH)
  })

  test('and a setting a newer build wrote is simply not one of these', () => {
    expect(graphSettingsOf({ arrows: true, curvature: 3 }).arrows).toBe(true)
  })

  test('and a store that was written by hand cannot make a picture of nothing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json')
    expect(new SpaceGraphSettings(() => ROOT).here).toEqual(DEFAULT_GRAPH)
  })
})

describe('two sets of settings', () => {
  test('are the same when they say the same thing', () => {
    expect(sameGraph(DEFAULT_GRAPH, graphSettingsOf({}))).toBe(true)
    expect(sameGraph(DEFAULT_GRAPH, graphSettingsOf({ arrows: true }))).toBe(false)
  })
})

describe('the space folder itself moving', () => {
  test('takes the settings with it, since they are kept under its path', () => {
    graph.set({ filter: 'tag:work' })
    graph.spaceMoved(ROOT, '/moved')

    expect(graph.of('/moved').filter).toBe('tag:work')
    expect(graph.of(ROOT)).toEqual(DEFAULT_GRAPH)
  })

  test('and a space that has gone is forgotten', () => {
    graph.set({ filter: 'tag:work' })
    graph.forget(ROOT)

    expect(graph.here).toEqual(DEFAULT_GRAPH)
  })
})

/** Which copy wins, which is the one thing about this that is not obvious: this
 *  machine's the first time an account meets the space and has nothing of its own
 *  to say, and the account's on every pass after that. */
describe('what the account holds', () => {
  test('is taken on outright once the space has been met', () => {
    graph.adopt(ROOT, { filter: 'tag:work', arrows: true }, 'u1')
    expect(graph.here.filter).toBe('tag:work')

    graph.adopt(ROOT, { filter: 'tag:later' }, 'u1')
    expect(graph.here.filter).toBe('tag:later')
    expect(graph.here.arrows).toBe(false)
  })

  test('and this machine keeps its own where the account has said nothing yet', () => {
    graph.set({ filter: 'plan' })
    graph.adopt(ROOT, {}, 'u1')

    expect(graph.here.filter).toBe('plan')
  })

  test('and a service too old to know about the picture takes nothing away', () => {
    graph.set({ filter: 'plan' })
    graph.adopt(ROOT, undefined, 'u1')

    expect(graph.here.filter).toBe('plan')
  })

  test('and another account signing in on this machine folds again', () => {
    graph.adopt(ROOT, { filter: 'theirs' }, 'u1')
    graph.set({ filter: 'mine' })
    graph.adopt(ROOT, {}, 'u2')

    expect(graph.here.filter).toBe('mine')
  })
})
