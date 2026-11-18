import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChatSocket, type Dial, type Heard } from './socket'

const CHAT = `c_${'c'.repeat(32)}`

function dialed() {
  const sockets: {
    protocols: string[]
    sent: string[]
    on: Parameters<Dial>[2]
    closed: boolean
  }[] = []
  const dial: Dial = (_url, protocols, on) => {
    const one = { protocols, sent: [] as string[], on, closed: false }
    sockets.push(one)
    return { send: (said) => one.sent.push(said), close: () => (one.closed = true) }
  }
  return { sockets, dial }
}

function heard(): Heard & { calls: string[] } {
  const calls: string[] = []
  const note =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name} ${JSON.stringify(args)}`)
  return {
    calls,
    events: note('events'),
    behind: note('behind'),
    typing: note('typing'),
    read: note('read'),
    here: note('here'),
    profile: note('profile'),
    state: note('state'),
    ended: note('ended'),
  }
}

const open: ChatSocket[] = []

function started(device: string | null = null, since = 0) {
  const { sockets, dial } = dialed()
  const ears = heard()
  const socket = new ChatSocket(CHAT, 'token', device, () => since, ears, dial)
  open.push(socket)
  return { sockets, ears, socket }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const socket of open.splice(0)) socket.close()
  vi.useRealTimers()
})

describe('a chat’s socket', () => {
  test('says hello with the place held, and hands on what it hears', () => {
    const { sockets, ears, socket } = started('device-0001', 41)
    const [one] = sockets
    expect(one?.protocols).toEqual(['orden.token.token', 'orden.device.device-0001'])
    one?.on.opened()
    expect(one?.sent[0]).toBe(JSON.stringify({ t: 'hello', since: 41 }))
    expect(socket.read(42)).toBe(true)

    one?.on.heard(JSON.stringify({ t: 'here', who: ['user:ana'] }))
    one?.on.heard(JSON.stringify({ t: 'behind', seq: 90_000 }))
    one?.on.heard('not a frame')
    expect(ears.calls).toEqual(['state [true]', 'here [["user:ana"]]', 'behind [90000]'])
  })

  test('comes back after a drop, and not after the log ends it', () => {
    const { sockets, ears, socket } = started()
    sockets[0]?.on.opened()
    sockets[0]?.on.closed(1006)
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2)

    sockets[1]?.on.opened()
    sockets[1]?.on.closed(1008)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(2)
    expect(ears.calls.at(-1)).toBe('ended []')
    expect(socket.open).toBe(false)
  })

  test('is not dialled again once the server says the session ended', () => {
    const { sockets, ears } = started()
    sockets[0]?.on.opened()
    sockets[0]?.on.closed(4401)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
    expect(ears.calls.at(-1)).toBe('ended []')
  })

  test('a socket that stops answering its beats is dropped and dialled again', () => {
    const { sockets, ears, socket } = started()
    sockets[0]?.on.opened()
    for (let beat = 0; beat < 6; beat++) {
      vi.advanceTimersByTime(10_000)
      sockets[0]?.on.heard('ok')
    }
    expect(sockets[0]?.closed).toBe(false)
    expect(socket.open).toBe(true)

    vi.advanceTimersByTime(30_000)
    expect(sockets[0]?.closed).toBe(true)
    expect(ears.calls.at(-1)).toBe('state [false]')
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2)
  })

  test('waits longer each time a socket is closed as soon as it opens', () => {
    const { sockets } = started()
    for (let at = 0; at < 600; at++) {
      const last = sockets.at(-1)
      if (last && !last.closed && last.sent.length === 0) {
        last.on.opened()
        last.on.closed(1011)
      }
      vi.advanceTimersByTime(100)
    }
    expect(sockets.length).toBeLessThanOrEqual(12)
  })

  test('waits its first wait again once a socket has outlived a beat', () => {
    const { sockets } = started()
    for (let turn = 0; turn < 4; turn++) {
      sockets.at(-1)?.on.opened()
      sockets.at(-1)?.on.closed(1011)
      while (sockets.length === turn + 1) vi.advanceTimersByTime(100)
    }

    const kept = sockets.at(-1)
    kept?.on.opened()
    vi.advanceTimersByTime(10_000)
    kept?.on.closed(1011)
    vi.advanceTimersByTime(600)
    expect(sockets).toHaveLength(6)
  })

  test('a socket that never opens is given up on and dialled again', () => {
    const { sockets } = started()
    vi.advanceTimersByTime(10_000)
    expect(sockets[0]?.closed).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2)
  })
})
