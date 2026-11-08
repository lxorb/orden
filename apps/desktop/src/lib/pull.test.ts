import { beforeEach, describe, expect, test, vi } from 'vitest'

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
const screen = vi.hoisted(() => ({ typing: false }))
vi.mock('./viewport.svelte', () => ({ viewport: screen }))

import { armed, CLAIM, claimsPull, pull, pulled, REACH } from './pull.svelte'

beforeEach(() => {
  localStorage.clear()
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

describe('what it runs', () => {
  test('always a reload, with no choice of another left from an older build (#2022)', async () => {
    localStorage.setItem('orden:pull', 'app.palette')
    pull.restore()
    expect(localStorage.getItem('orden:pull')).toBeNull()
    refreshing.calls = 0
    refreshing.answer = () => Promise.resolve()
    await pull.press()
    expect(refreshing.calls).toBe(1)
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
})

describe('a pull never over the reader’s words (#1065)', () => {
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
