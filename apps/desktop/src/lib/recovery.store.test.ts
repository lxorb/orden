import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The store writes to the browser's storage as soon as anything is chosen, and
 *  under node there is none, so it is stood in for before the store is
 *  imported. */
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

/** Every command the store sends, in order. */
const sent = vi.hoisted(() => ({
  calls: [] as { command: string; args: Record<string, unknown> }[],
}))

vi.mock('./tauri', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    sent.calls.push({ command, args })
    return Promise.resolve(0)
  },
  isDesktop: true,
  isNative: true,
}))

/** The notes the workspace says have been typed in since they were written. */
const open = vi.hoisted(() => ({
  unsaved: [] as { path: string | null; text: string }[],
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get unsaved() {
      return open.unsaved
    },
  },
}))

vi.mock('./account.svelte', () => ({ account: { token: null } }))

const { recovery } = await import('./recovery.svelte')
const { DEFAULT_DAYS, DEFAULT_MINUTES } = await import('./recovery')

const MINUTE = 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sent.calls = []
  open.unsaved = []
  recovery.setEvery(DEFAULT_MINUTES)
  recovery.setDays(DEFAULT_DAYS)
  sent.calls = []
})

afterEach(() => {
  vi.useRealTimers()
})

/** What the commands say, so a test reads them without the arguments. */
const commands = () => sent.calls.map((one) => one.command)

describe('the versions kept while a note is being written in', () => {
  test('sweeps once on the way up, by the retention that is set', () => {
    const stop = recovery.start()

    expect(sent.calls[0]).toEqual({ command: 'purge_snapshots', args: { days: DEFAULT_DAYS } })
    stop()
  })

  test('keeps every note that has been typed in, on one timer', async () => {
    open.unsaved = [
      { path: '/notes/a.md', text: 'one' },
      { path: '/notes/b.md', text: 'two' },
    ]

    const stop = recovery.start()
    sent.calls = []
    // Awaited, because the tick keeps one note at a time: a version half
    // written is worse than a version late.
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

  test('leaves a note with nowhere to be saved alone', () => {
    open.unsaved = [{ path: null, text: 'untitled' }]

    const stop = recovery.start()
    sent.calls = []
    vi.advanceTimersByTime(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('and one with nothing in it', () => {
    open.unsaved = [{ path: '/notes/a.md', text: '   \n' }]

    const stop = recovery.start()
    sent.calls = []
    vi.advanceTimersByTime(DEFAULT_MINUTES * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('follows the interval that is chosen', () => {
    open.unsaved = [{ path: '/notes/a.md', text: 'one' }]
    const stop = recovery.start()

    recovery.setEvery(1)
    sent.calls = []
    vi.advanceTimersByTime(MINUTE)
    expect(commands()).toEqual(['snapshot_note'])

    stop()
  })

  test('and stops altogether when it is off', () => {
    open.unsaved = [{ path: '/notes/a.md', text: 'one' }]
    const stop = recovery.start()

    recovery.setEvery(0)
    sent.calls = []
    vi.advanceTimersByTime(60 * MINUTE)

    expect(commands()).toEqual([])
    stop()
  })

  test('nothing is left running once it is stopped', () => {
    open.unsaved = [{ path: '/notes/a.md', text: 'one' }]
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

    expect(localStorage.getItem('nib:recovery')).toBe(JSON.stringify({ every: 15, days: 30 }))
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
