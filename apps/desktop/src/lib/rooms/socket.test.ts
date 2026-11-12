import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BEAT, BEAT_ANSWER } from '@orden/sync-core'
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static made: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  readonly sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.made.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  up() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  answer(data: unknown) {
    this.onmessage?.({ data })
  }
}

const listeners = new Map<string, Set<() => void>>()
const fakeWindow = {
  addEventListener: (name: string, run: () => void) => {
    const all = listeners.get(name) ?? new Set()
    all.add(run)
    listeners.set(name, all)
  },
  removeEventListener: (name: string, run: () => void) => listeners.get(name)?.delete(run),
}

function online() {
  for (const run of listeners.get('online') ?? []) run()
}

vi.stubGlobal('WebSocket', FakeWebSocket)
vi.stubGlobal('window', fakeWindow)

const { RoomSocket } = await import('./socket')

function last(): FakeWebSocket {
  const socket = FakeWebSocket.made.at(-1)
  if (!socket) throw new Error('nothing was dialled')
  return socket
}

function dialled() {
  const closed: number[] = []
  const room = new RoomSocket('n1', 'session', {
    opened: () => undefined,
    heard: () => undefined,
    closed: (code) => closed.push(code),
  })
  room.start()
  return { room, closed }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.made = []
  listeners.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a room connection that goes quiet', () => {
  test('beats while it is open', () => {
    dialled()
    last().up()

    vi.advanceTimersByTime(10_000)

    expect(last().sent).toContain(BEAT)
  })

  test('is given up on and dialled again once the room stops answering its beats', () => {
    const { closed } = dialled()
    const first = last()
    first.up()
    first.answer(BEAT_ANSWER)

    vi.advanceTimersByTime(30_000)

    expect(first.readyState).toBe(FakeWebSocket.CLOSED)
    expect(closed).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.made).toHaveLength(2)
  })

  test('is kept while the room answers', () => {
    const { closed } = dialled()
    const first = last()
    first.up()

    for (let beat = 0; beat < 10; beat++) {
      first.answer(BEAT_ANSWER)
      vi.advanceTimersByTime(10_000)
    }

    expect(closed).toEqual([])
    expect(FakeWebSocket.made).toHaveLength(1)
  })

  test('is kept by a room that has never answered a beat, which is a room from before beats', () => {
    const { closed } = dialled()
    last().up()

    vi.advanceTimersByTime(120_000)

    expect(closed).toEqual([])
    expect(FakeWebSocket.made).toHaveLength(1)
  })

  test('is given up on when it never opens', () => {
    const { closed } = dialled()

    vi.advanceTimersByTime(10_000)

    expect(closed).toHaveLength(1)
    expect(last().readyState).toBe(FakeWebSocket.CLOSED)
  })
})

describe('a room connection waiting to dial again', () => {
  test('dials at once when the device is back online', () => {
    dialled()
    const first = last()
    first.up()
    for (let gone = 0; gone < 6; gone++) {
      last().onclose?.({ code: 1006, reason: '' })
      vi.advanceTimersByTime(25_000)
    }
    const before = FakeWebSocket.made.length
    last().onclose?.({ code: 1006, reason: '' })

    online()

    expect(FakeWebSocket.made).toHaveLength(before + 1)
  })

  test('stops listening once it is stopped', () => {
    const { room } = dialled()
    room.stop()

    expect(listeners.get('online')?.size ?? 0).toBe(0)
  })
})
