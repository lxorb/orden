import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEEPEST,
  DEFAULT_GRAPH,
  graphSettingsOf,
  LEAST_DISTANCE,
  LEAST_FADE,
  LEAST_LINES,
  LEAST_PUSH,
  MOST_DISTANCE,
  MOST_FADE,
  MOST_GROUPS,
  MOST_LINES,
  MOST_PUSH,
  sameGraph,
  SpaceGraphSettings,
  STORAGE_KEY,
} from './graph-settings.svelte'

let writes = 0

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1
      store.set(key, value)
    },
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const ROOT = '/space'

let graph: SpaceGraphSettings

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  graph = new SpaceGraphSettings(() => ROOT)
})

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
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
    expect(graph.here.depth).toBe(DEEPEST)
  })

  test('and the depth reaches five, one link at a step', () => {
    expect(DEEPEST).toBe(5)

    graph.set({ depth: 4 })
    expect(graph.here.depth).toBe(4)

    graph.set({ depth: 5 })
    expect(graph.here.depth).toBe(5)

    graph.set({ depth: 0 })
    expect(graph.here.depth).toBe(1)
  })

  test('holds the Lines dial to its three steps, the middle one by default', () => {
    expect(graph.here.lines).toBe(2)

    graph.set({ lines: 9 })
    expect(graph.here.lines).toBe(MOST_LINES)

    graph.set({ lines: -4 })
    expect(graph.here.lines).toBe(LEAST_LINES)

    graph.set({ lines: 2.6 })
    expect(graph.here.lines).toBe(3)
  })

  test('holds the text fade to what the dial offers, one by default', () => {
    expect(graph.here.fade).toBe(1)

    graph.set({ fade: 0.5 })
    expect(graph.here.fade).toBe(0.5)

    graph.set({ fade: 40 })
    expect(graph.here.fade).toBe(MOST_FADE)

    graph.set({ fade: 0 })
    expect(graph.here.fade).toBe(LEAST_FADE)
  })

  test('holds the two remaining forces to their dials, at their old values', () => {
    expect(graph.here.distance).toBe(36)
    expect(graph.here.push).toBe(150)

    graph.set({ distance: 900, push: 9000 })
    expect(graph.here.distance).toBe(MOST_DISTANCE)
    expect(graph.here.push).toBe(MOST_PUSH)

    graph.set({ distance: 0, push: 0 })
    expect(graph.here.distance).toBe(LEAST_DISTANCE)
    expect(graph.here.push).toBe(LEAST_PUSH)
  })

  test('takes at most one colour group per colour the theme names', () => {
    const many = Array.from({ length: MOST_GROUPS + 3 }, (_one, index) => ({
      query: `tag:t${index}`,
      colour: 1,
    }))
    graph.set({ groups: many })

    expect(graph.here.groups).toHaveLength(MOST_GROUPS)
  })

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
    graph.flush()

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

describe('a whole view, taken at once', () => {
  test('is the picture that bookmark was kept from', () => {
    graph.take('{"filter":"tag:work","arrows":true,"depth":2}')

    expect(graph.here.filter).toBe('tag:work')
    expect(graph.here.arrows).toBe(true)
    expect(graph.here.depth).toBe(2)
    expect(graph.here.orphans).toBe(DEFAULT_GRAPH.orphans)
  })

  test('and a row with nothing in it leaves the picture alone', () => {
    graph.set({ filter: 'tag:now' })

    graph.take(undefined)
    graph.take('not json')
    graph.take('')

    expect(graph.here.filter).toBe('tag:now')
  })

  test('and carries every setting the card can change, not a chosen few', () => {
    const kept = {
      filter: 'tag:work',
      orphans: false,
      attachments: true,
      groups: [{ query: 'tag:later', colour: 4 }],
      spread: 2,
      gather: false,
      distance: 60,
      push: 220,
      arrows: true,
      sized: false,
      lines: 3,
      fade: 2,
      depth: 4,
    }

    graph.take(JSON.stringify(kept))

    expect(graph.here).toEqual(kept)
    expect(Object.keys(graph.here).sort()).toEqual(Object.keys(DEFAULT_GRAPH).sort())
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

describe('typing a filter', () => {
  test('writes storage once when the typing stops, not once a letter', () => {
    vi.useFakeTimers()
    try {
      const before = writes
      for (const filter of ['t', 'ta', 'tag', 'tag:', 'tag:w', 'tag:wo', 'tag:work']) {
        graph.set({ filter })
      }

      expect(writes - before).toBe(0)
      expect(graph.here.filter).toBe('tag:work')

      vi.advanceTimersByTime(2000)
      expect(writes - before).toBe(1)
      expect(new SpaceGraphSettings(() => ROOT).here.filter).toBe('tag:work')
    } finally {
      vi.useRealTimers()
    }
  })

  test('and a window going away writes what the timer has not', () => {
    vi.useFakeTimers()
    try {
      const before = writes
      graph.set({ filter: 'tag:work' })
      expect(writes - before).toBe(0)

      graph.flush()
      expect(writes - before).toBe(1)

      vi.advanceTimersByTime(2000)
      expect(writes - before).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
