import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

const sent = vi.hoisted(() => ({
  calls: [] as { command: string; args: Record<string, unknown> }[],
}))

vi.mock('./platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    sent.calls.push({ command, args })
    return Promise.resolve(0)
  },
  isDesktop: true,
  isNative: true,
}))

const open = vi.hoisted(() => ({
  notes: [] as { key: string; path: string; text: string; revision: number }[],
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get worthKeeping() {
      return open.notes
    },
  },
}))

vi.mock('./accounts/src/account.svelte', () => ({ account: { token: null } }))

const { recovery } = await import('./recovery.svelte')
const { DEFAULT_DAYS, DEFAULT_MINUTES } = await import('./recovery')

const MINUTE = 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sent.calls = []
  open.notes = []
  recovery.setEvery(DEFAULT_MINUTES)
  recovery.setDays(DEFAULT_DAYS)
  sent.calls = []
})

afterEach(() => {
  vi.useRealTimers()
})

const commands = () => sent.calls.map((one) => one.command)

describe('the versions kept while a note is being written in', () => {
  test('sweeps once on the way up, by the retention that is set', () => {
    const stop = recovery.start()

    expect(sent.calls[0]).toEqual({ command: 'purge_snapshots', args: { days: DEFAULT_DAYS } })
    stop()
  })

  test('keeps every note that has been typed in, on one timer', async () => {
    open.notes = [
      { key: 'a', path: '/notes/a.md', text: 'one', revision: 1 },
      { key: 'b', path: '/notes/b.md', text: 'two', revision: 1 },
    ]

    const stop = recovery.start()
    sent.calls = []
    await vi.advanceTimersByTimeAsync(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual(['snapshot_note', 'snapshot_note'])
    expect(sent.calls.map((one) => one.args.path)).toEqual(['/notes/a.md', '/notes/b.md'])
    stop()
  })

  test('and nothing at all when nothing has been typed in', () => {
    const stop = recovery.start()
    sent.calls = []
    vi.advanceTimersByTime(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('leaves a note nobody has typed in alone, however long it stays open', () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one', revision: 0 }]

    const stop = recovery.start()
    sent.calls = []
    vi.advanceTimersByTime(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('and one with nothing in it', () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: '   \n', revision: 1 }]

    const stop = recovery.start()
    sent.calls = []
    vi.advanceTimersByTime(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('keeps a version again once the words have moved, and not before', async () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one', revision: 1 }]
    const stop = recovery.start()
    sent.calls = []

    await vi.advanceTimersByTimeAsync(DEFAULT_MINUTES * MINUTE)
    expect(commands()).toEqual(['snapshot_note'])

    sent.calls = []
    await vi.advanceTimersByTimeAsync(DEFAULT_MINUTES * MINUTE)
    expect(commands()).toEqual([])

    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one, typed', revision: 2 }]
    await vi.advanceTimersByTimeAsync(DEFAULT_MINUTES * MINUTE)
    expect(sent.calls).toEqual([
      { command: 'snapshot_note', args: { path: '/notes/a.md', content: 'one, typed' } },
    ])
    stop()
  })

  test('follows the interval that is chosen', () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one', revision: 1 }]
    const stop = recovery.start()

    recovery.setEvery(1)
    sent.calls = []
    vi.advanceTimersByTime(MINUTE)
    expect(commands()).toEqual(['snapshot_note'])

    stop()
  })

  test('and stops altogether when it is off', () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one', revision: 1 }]
    const stop = recovery.start()

    recovery.setEvery(0)
    sent.calls = []
    vi.advanceTimersByTime(60 * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('nothing is left running once it is stopped', () => {
    open.notes = [{ key: 'a', path: '/notes/a.md', text: 'one', revision: 1 }]
    recovery.start()()

    sent.calls = []
    vi.advanceTimersByTime(48 * 60 * MINUTE)
    expect(commands()).toEqual([])
  })

  test('a retention chosen sweeps at once', () => {
    recovery.setDays(1)
    expect(sent.calls).toEqual([{ command: 'purge_snapshots', args: { days: 1 } }])
  })

  test('the choices are remembered', () => {
    recovery.setEvery(15)
    recovery.setDays(30)

    expect(localStorage.getItem('orden:recovery')).toBe(JSON.stringify({ every: 15, days: 30 }))
  })

  test('and taken from the account', () => {
    recovery.receive({ recoveryEvery: 1, recoveryDays: 30 })
    expect(recovery.every).toBe(1)
    expect(recovery.days).toBe(30)
  })

  test('but not a number the app has no option for', () => {
    recovery.receive({ recoveryEvery: 3, recoveryDays: 365 })
    expect(recovery.every).toBe(DEFAULT_MINUTES)
    expect(recovery.days).toBe(DEFAULT_DAYS)
  })
})
