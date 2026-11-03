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

/** What a reload does where the reader is, heard: see refresh.ts. */
const refreshing = vi.hoisted(() => ({
  calls: 0,
  answer: (): Promise<void> => Promise.resolve(),
}))
vi.mock('./refresh', () => ({
  refreshHere: () => {
    refreshing.calls++
    return refreshing.answer()
  },
}))
/** Whether the keyboard is up. */
const screen = vi.hoisted(() => ({ typing: false }))
vi.mock('./viewport.svelte', () => ({ viewport: screen }))

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
  test('reload, until somebody says otherwise (#1065)', () => {
    expect(DEFAULT_PULL).toBe('app.refresh')
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

describe('a pull let go of (#1065)', () => {
  test('reloads where the reader is, the mark turning until it is done', async () => {
    let finish: () => void = () => undefined
    refreshing.calls = 0
    const waited = new Promise<void>((done) => (finish = done))
    refreshing.answer = () => waited
    const pressed = pull.press()
    await vi.waitFor(() => expect(refreshing.calls).toBe(1))
    expect(pull.refreshing).toBe(true)
    // A second pull while the first is under way is the same reload.
    await pull.press()
    expect(refreshing.calls).toBe(1)
    finish()
    await pressed
    expect(pull.refreshing).toBe(false)
    expect(pull.failed).toBe(false)
  })

  test('says so quietly where the reload did not finish', async () => {
    refreshing.answer = () => Promise.reject(new Error('offline'))
    await pull.press()
    expect(pull.refreshing).toBe(false)
    expect(pull.failed).toBe(true)
  })

  test('presses another command at once where one was chosen', async () => {
    const runs = vi.fn()
    pull.runs = runs
    refreshing.calls = 0
    pull.choose('app.palette')
    await pull.press()
    expect(runs).toHaveBeenCalledOnce()
    expect(refreshing.calls).toBe(0)
    pull.runs = null
  })
})

describe('a pull never over the reader’s words (#1065)', () => {
  /** A surface at its top, a finger down on it and pulled down past the reach. */
  function pulledDown(): void {
    const surface = new EventTarget() as unknown as HTMLElement
    Object.assign(surface, { scrollTop: 0 })
    const stop = pull.follow(surface)
    const at = (y: number) => [{ clientX: 0, clientY: y }]
    const touch = (type: string, touches: { clientX: number; clientY: number }[]) => {
      const event = Object.assign(new Event(type, { cancelable: true }), { touches })
      surface.dispatchEvent(event)
    }
    touch('touchstart', at(0))
    touch('touchmove', at(40))
    touch('touchmove', at(400))
    lastAt = pull.at
    stop()
  }
  let lastAt = 0

  test('follows the finger where the keyboard is down', () => {
    screen.typing = false
    pulledDown()
    expect(lastAt).toBeGreaterThan(0)
  })

  test('and never while the keyboard is up', () => {
    screen.typing = true
    pulledDown()
    expect(lastAt).toBe(0)
    screen.typing = false
  })
})
