import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Pulling a note or a list down past its top. The gesture has to tell itself
 *  apart from the two movements it sits between - a scroll and the drawer's
 *  sideways drag - and it has to be a choice somebody can put away. */

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

import {
  armed,
  CLAIM,
  claimsPull,
  DEFAULT_PULL,
  NOTHING,
  pull,
  pulled,
  REACH,
  usable,
} from './pull.svelte'

beforeEach(() => {
  localStorage.clear()
  pull.chosen = null
  pull.at = 0
})

describe('whether a movement is this gesture', () => {
  test('down, and further down than sideways', () => {
    expect(claimsPull(0, CLAIM)).toBe(true)
    expect(claimsPull(4, 40)).toBe(true)
  })

  test('not a scroll that went nowhere', () => {
    expect(claimsPull(0, CLAIM - 1)).toBe(false)
    expect(claimsPull(0, 0)).toBe(false)
  })

  test('and never the drawer, which is the sideways one', () => {
    expect(claimsPull(60, 20)).toBe(false)
    expect(claimsPull(-60, 20)).toBe(false)
  })
})

describe('how far the surface follows', () => {
  test('less than the finger, and by less and less', () => {
    // Rubber: the first stretch is nearly free and the rest gets heavier, which
    // is what says something is being reached for rather than dragged.
    const near = pulled(20)
    const far = pulled(200)

    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(20 * 1.6)
    expect(far).toBeGreaterThan(near)
    expect(pulled(1000)).toBe(pulled(4000))
  })

  test('nothing at all upwards', () => {
    expect(pulled(0)).toBe(0)
    expect(pulled(-40)).toBe(0)
  })

  test('and the reach is where letting go means something', () => {
    expect(armed(REACH - 1)).toBe(false)
    expect(armed(REACH)).toBe(true)
  })
})

describe('which command it runs', () => {
  test('search, until somebody says otherwise', () => {
    expect(pull.id).toBe(DEFAULT_PULL)
    expect(pull.changed).toBe(false)
  })

  test('whatever was chosen', () => {
    pull.choose('app.palette')
    expect(pull.id).toBe('app.palette')
    expect(pull.changed).toBe(true)
    expect(localStorage.getItem('nib:pull')).toBe('app.palette')
  })

  test('choosing the one it offers anyway is choosing nothing', () => {
    // Stored as nothing, so a default that changes later still reaches here.
    pull.choose(DEFAULT_PULL)
    expect(pull.changed).toBe(false)
    expect(localStorage.getItem('nib:pull')).toBeNull()
  })

  test('or no gesture at all, which is a choice', () => {
    pull.choose(NOTHING)
    expect(pull.id).toBe(NOTHING)
    expect(pull.changed).toBe(true)
  })

  test('and never a command nothing can press', () => {
    pull.choose('nothing.at.all')
    expect(pull.id).toBe(DEFAULT_PULL)
  })
})

describe('what the account may say about it', () => {
  test('a command, the word for none, or nothing', () => {
    expect(usable('app.palette')).toBe('app.palette')
    expect(usable(NOTHING)).toBe(NOTHING)
    expect(usable('made.up')).toBeNull()
    expect(usable(7)).toBeNull()
    expect(usable(null)).toBeNull()
  })

  test('and this device takes it over', () => {
    pull.receive({ pull: 'app.palette' })
    expect(pull.id).toBe('app.palette')

    pull.receive({ pull: null })
    expect(pull.id).toBe(DEFAULT_PULL)
  })

  test('an account that has never been told anything leaves this one alone', () => {
    pull.choose('app.palette')
    pull.receive({})
    expect(pull.id).toBe('app.palette')
  })
})
