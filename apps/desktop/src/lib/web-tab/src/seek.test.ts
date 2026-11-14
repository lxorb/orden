import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const called: { command: string; args: Record<string, unknown> }[] = []

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    called.push({ command, args })
    return Promise.resolve(undefined)
  },
}))

const { seek, shut, sought } = await import('./seek')
const { addressing, answer, readAsk } = await import('./passed.svelte')
const { Page } = await import('./pages.svelte')

beforeEach(() => {
  called.length = 0
})

function pageScript(): string {
  const crate = readFileSync(
    fileURLToPath(new URL('../../../../src-tauri/src/web_opens.rs', import.meta.url)),
    'utf8',
  )
  const found = /pub const SCRIPT: &str = r"([\s\S]*?)";/.exec(crate)
  if (!found?.[1]) throw new Error('web_opens.rs has no SCRIPT')
  return found[1]
}

interface Key {
  keyCode: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  isTrusted?: boolean
  key?: string
  timeStamp?: number
  repeat?: boolean
  isComposing?: boolean
  target?: unknown
}

interface Heard {
  type: string
  handler: (event: Pressed) => void
  capture: boolean
}

type Pressed = Required<Key> & {
  type: string
  readonly defaultPrevented: boolean
  preventDefault: () => void
}

function page(own: number | null = null) {
  const opened: string[] = []
  const heard: Heard[] = []
  const window = {
    open(this: unknown, _url: string, name: string) {
      if (this !== window) throw new Error('open called off the window')
      opened.push(name)
      return null
    },
  }
  const at = (type: string, handler: Heard['handler'], capture: boolean) =>
    heard.findIndex(
      (one) => one.type === type && one.handler === handler && one.capture === capture,
    )
  const addEventListener = (type: string, handler: Heard['handler'], capture = false) => {
    if (at(type, handler, capture) < 0) heard.push({ type, handler, capture })
  }
  const removeEventListener = (type: string, handler: Heard['handler'], capture = false) => {
    const index = at(type, handler, capture)
    if (index >= 0) heard.splice(index, 1)
  }
  runInNewContext(pageScript(), {
    window,
    addEventListener,
    removeEventListener,
    setTimeout,
    Element: Object,
  })

  window.open = () => {
    throw new Error("the page's own open")
  }
  let ownFind = 0
  if (own !== null) {
    addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.keyCode === own) {
        event.preventDefault()
        ownFind++
      }
    })
  }

  const turn = (event: Pressed, capture: boolean) => {
    const now = heard.filter((one) => one.type === event.type && one.capture === capture)
    for (const one of now) if (heard.includes(one)) one.handler(event)
  }
  const press = (key: Key, type = 'keydown') => {
    let prevented = false
    const event: Pressed = {
      type,
      key: '',
      timeStamp: 0,
      repeat: false,
      isComposing: false,
      target: null,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      isTrusted: true,
      ...key,
      get defaultPrevented() {
        return prevented
      },
      preventDefault() {
        prevented = true
      },
    }
    turn(event, true)
    turn(event, false)
    return { opened: opened.splice(0), prevented }
  }
  const takeShift = () =>
    addEventListener('keyup', (event) => {
      if (event.key === 'Shift') event.preventDefault()
    })

  return { press, own: () => ownFind, window, takeShift }
}

describe('the script in every page', () => {
  test('asks for the find on Ctrl+F nothing in the page took, and keeps the engine off it', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true })).toEqual({
      opened: ['orden-find'],
      prevented: true,
    })
  })

  test('leaves Ctrl+F to a page with a find of its own, added after the script', () => {
    const one = page(70)
    expect(one.press({ keyCode: 70, ctrlKey: true })).toEqual({ opened: [], prevented: true })
    expect(one.press({ keyCode: 70, ctrlKey: true }).opened).toEqual([])
    expect(one.own()).toBe(2)
    expect(one.press({ keyCode: 71, ctrlKey: true }).opened).toEqual(['orden-find-next'])
  })

  test('steps on Ctrl+G and F3, back with Shift', () => {
    const one = page()
    expect(one.press({ keyCode: 71, ctrlKey: true }).opened).toEqual(['orden-find-next'])
    expect(one.press({ keyCode: 71, ctrlKey: true, shiftKey: true }).opened).toEqual([
      'orden-find-previous',
    ])
    expect(one.press({ keyCode: 114 }).opened).toEqual(['orden-find-next'])
    expect(one.press({ keyCode: 114, shiftKey: true }).opened).toEqual(['orden-find-previous'])
  })

  test('leaves every other key alone', () => {
    const one = page()
    const others: Key[] = [
      { keyCode: 76, ctrlKey: true, shiftKey: true },
      { keyCode: 68, ctrlKey: true, altKey: true },
      { keyCode: 68, altKey: true, shiftKey: true },
      { keyCode: 70 },
      { keyCode: 70, ctrlKey: true, shiftKey: true },
      { keyCode: 70, ctrlKey: true, altKey: true },
      { keyCode: 71, ctrlKey: true, altKey: true },
      { keyCode: 70, ctrlKey: true, metaKey: true },
      { keyCode: 114, ctrlKey: true },
      { keyCode: 71 },
      { keyCode: 75, ctrlKey: true },
    ]
    for (const key of others) {
      expect(one.press(key), JSON.stringify(key)).toEqual({ opened: [], prevented: false })
    }
  })

  test('asks for the address field on Ctrl+L and Alt+D nothing in the page took', () => {
    const one = page()
    expect(one.press({ keyCode: 76, ctrlKey: true }).opened).toEqual(['orden-address'])
    expect(one.press({ keyCode: 68, altKey: true }).opened).toEqual(['orden-address'])
  })

  test('asks for a hundred per cent on Ctrl+0 nothing in the page took, row or number pad', () => {
    const one = page()
    const actual = { opened: ['orden-actual-size'], prevented: true }
    expect(one.press({ keyCode: 48, ctrlKey: true })).toEqual(actual)
    expect(one.press({ keyCode: 96, ctrlKey: true })).toEqual(actual)
    for (const key of [
      { keyCode: 48, ctrlKey: true, shiftKey: true },
      { keyCode: 48, ctrlKey: true, altKey: true },
      { keyCode: 48 },
      { keyCode: 96 },
    ]) {
      expect(one.press(key), JSON.stringify(key)).toEqual({ opened: [], prevented: false })
    }
  })

  test('leaves Ctrl+0 to a page that answers it itself', () => {
    const one = page(48)
    expect(one.press({ keyCode: 48, ctrlKey: true })).toEqual({ opened: [], prevented: true })
    expect(one.own()).toBe(1)
  })

  test('answers only a key a person pressed', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true, isTrusted: false }).opened).toEqual([])
  })
})

describe('a modifier tapped twice in a page', () => {
  function tap(one: ReturnType<typeof page>, at: number, key = 'Shift') {
    const held = { key, keyCode: 16, shiftKey: key === 'Shift', ctrlKey: key === 'Control' }
    one.press({ ...held, timeStamp: at }, 'keydown')
    return one.press({ key, keyCode: 16, timeStamp: at + 40 }, 'keyup').opened
  }

  test('asks for the palette on the second release', () => {
    const one = page()
    expect(tap(one, 0)).toEqual([])
    expect(tap(one, 150)).toEqual(['orden-twice-shift'])
  })

  test('by the same rules as the app: too slow, a letter between, or a click is not one', () => {
    const slow = page()
    tap(slow, 0)
    expect(tap(slow, 1000)).toEqual([])

    const typed = page()
    tap(typed, 0)
    typed.press({ key: 'a', keyCode: 65, timeStamp: 100 }, 'keydown')
    expect(tap(typed, 150)).toEqual([])

    const clicked = page()
    tap(clicked, 0)
    clicked.press({ keyCode: 0, timeStamp: 100 }, 'pointerdown')
    expect(tap(clicked, 150)).toEqual([])
  })

  test('once for five presses, which Windows reads as Sticky Keys', () => {
    const one = page()
    const asked = [0, 100, 200, 300, 400].flatMap((at) => tap(one, at))
    expect(asked).toEqual(['orden-twice-shift'])
  })

  test('for Ctrl as well, under a name of its own', () => {
    const one = page()
    tap(one, 0, 'Control')
    expect(tap(one, 150, 'Control')).toEqual(['orden-twice-ctrl'])
  })

  test('not where the page took the Shift for itself, and never for a synthetic one', () => {
    const own = page()
    own.takeShift()
    tap(own, 0)
    expect(tap(own, 150)).toEqual([])

    const fake = page()
    for (const at of [0, 150]) {
      fake.press(
        { key: 'Shift', keyCode: 16, shiftKey: true, timeStamp: at, isTrusted: false },
        'keydown',
      )
      expect(
        fake.press({ key: 'Shift', keyCode: 16, timeStamp: at + 40, isTrusted: false }, 'keyup')
          .opened,
      ).toEqual([])
    }
  })

  test('never takes the key from the page', () => {
    const one = page()
    const down = one.press({ key: 'Shift', keyCode: 16, shiftKey: true, timeStamp: 0 }, 'keydown')
    const up = one.press({ key: 'Shift', keyCode: 16, timeStamp: 40 }, 'keyup')
    expect([down.prevented, up.prevented]).toEqual([false, false])
  })
})

describe("the crate's word for an ask", () => {
  test('is one of seven, for a tab', () => {
    for (const key of [
      'find',
      'next',
      'previous',
      'address',
      'shift-shift',
      'ctrl-ctrl',
      'alt-alt',
    ]) {
      expect(readAsk({ tab: 't1', key })).toEqual({ tab: 't1', key })
    }
  })

  test('and nothing else is read as one', () => {
    for (const value of [
      null,
      'find',
      { key: 'find' },
      { tab: 't1' },
      { tab: 't1', key: 'open' },
      { tab: 't1', key: 'fresh' },
      { tab: 't1', key: 'app.close' },
      { tab: 1, key: 'find' },
    ]) {
      expect(readAsk(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('an ask', () => {
  test('for the find opens the bar', () => {
    const one = new Page()
    answer('t1', one, 'find')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test('for a step opens a shut bar too, as Chrome does', () => {
    const one = new Page()
    sought('t1', one, 'next')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test("for a step walks an open bar's matches", () => {
    const one = new Page()
    one.find.open = true
    one.find.query = 'orden'
    answer('t1', one, 'previous')
    expect(called).toEqual([
      { command: 'web_find', args: { tab: 't1', term: 'orden', look: 'previous' } },
    ])
  })

  test("for the address field is that page's, and a new ask each time", () => {
    const one = new Page()
    answer('t1', one, 'address')
    const first = addressing.asked
    expect(first?.page).toBe(one)
    expect(one.find.open).toBe(false)
    answer('t1', one, 'address')
    expect(addressing.asked).not.toBe(first)
    expect(addressing.asked?.page).toBe(one)
  })
})

describe('the bar', () => {
  test('lets go of the marks when the word is gone, and when it closes', () => {
    const one = new Page()
    one.find = { open: true, query: 'a', count: 3, at: 1 }
    seek('t1', one, '', 'fresh')
    expect(one.find).toMatchObject({ query: '', count: 0, at: -1 })
    shut('t1', one)
    expect(one.find.open).toBe(false)
    expect(called.map((one) => one.command)).toEqual([
      'web_find_stop',
      'web_find_stop',
      'keyboard_back',
    ])
  })

  test('gives the page its keyboard back as it closes, as in Chrome', () => {
    const one = new Page()
    one.find = { open: true, query: 'a', count: 3, at: 1 }
    shut('t1', one)
    expect(called.at(-1)).toEqual({ command: 'keyboard_back', args: { tab: 't1' } })
  })
})
