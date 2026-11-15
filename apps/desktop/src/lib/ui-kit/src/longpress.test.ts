import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { longPress } from './longpress'

interface Node {
  listeners: Map<string, (event: never) => void>
  dispatchEvent(event: Event): boolean
  addEventListener(kind: string, run: (event: never) => void): void
  removeEventListener(kind: string): void
}

function node(): Node {
  const listeners = new Map<string, (event: never) => void>()

  return {
    listeners,
    dispatchEvent: () => true,
    addEventListener(kind, run) {
      listeners.set(kind, run)
    },
    removeEventListener(kind) {
      listeners.delete(kind)
    },
  }
}

function at(x: number, y: number): unknown {
  return {
    touches: [{ clientX: x, clientY: y }],
    cancelable: true,
    preventDefault: () => undefined,
  }
}

class Event_ {
  constructor(
    readonly type: string,
    readonly detail: unknown = null,
  ) {}
}

let host: Node
let shown: number
let stop: () => void

beforeEach(() => {
  vi.stubGlobal('MouseEvent', Event_)
  vi.stubGlobal('CustomEvent', Event_)
  vi.useFakeTimers()
  host = node()
  shown = 0
  const action = longPress(host as unknown as HTMLElement, () => {
    shown++
  })
  stop = () => action.destroy()
})

afterEach(() => {
  stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function touch(kind: 'touchstart' | 'touchmove' | 'touchend', event: unknown) {
  host.listeners.get(kind)?.(event as never)
}

describe('a finger held still', () => {
  test('asks for the menu, once the hold is long enough', () => {
    touch('touchstart', at(100, 100))
    vi.advanceTimersByTime(499)
    expect(shown).toBe(0)

    vi.advanceTimersByTime(1)
    expect(shown).toBe(1)
  })

  test('and lifting before that asks for nothing', () => {
    touch('touchstart', at(100, 100))
    vi.advanceTimersByTime(300)
    touch('touchend', at(100, 100))
    vi.advanceTimersByTime(1000)

    expect(shown).toBe(0)
  })
})

describe('a finger that moves first', () => {
  test('never opens the menu, however long it is then held', () => {
    touch('touchstart', at(100, 100))
    vi.advanceTimersByTime(200)

    touch('touchmove', at(100, 118))
    vi.advanceTimersByTime(5000)

    expect(shown).toBe(0)
  })

  test('and a wobble inside the slop is still a press', () => {
    touch('touchstart', at(100, 100))
    vi.advanceTimersByTime(200)
    touch('touchmove', at(104, 103))
    vi.advanceTimersByTime(500)

    expect(shown).toBe(1)
  })

  test('sideways counts the same as up and down', () => {
    touch('touchstart', at(100, 100))
    touch('touchmove', at(130, 100))
    vi.advanceTimersByTime(5000)

    expect(shown).toBe(0)
  })
})

describe('two fingers', () => {
  test('are a pinch or a scroll, and ask for nothing', () => {
    touch('touchstart', {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 140, clientY: 140 },
      ],
    })
    vi.advanceTimersByTime(5000)

    expect(shown).toBe(0)
  })
})
