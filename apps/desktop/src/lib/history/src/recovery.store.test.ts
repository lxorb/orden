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
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
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
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get worthKeeping() {
      return open.notes
    },
  },
}))
const server = vi.hoisted(() => {
  const settings: Record<string, Record<string, unknown>> = {}
  return { settings, offline: false }
})
vi.mock('../../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/client')>()),
  api: {
    saveSettings: async (token: string, patch: Record<string, unknown>) => {
      if (server.offline) throw new Error('offline')
      server.settings[token] = { ...server.settings[token], ...patch }
      return { settings: server.settings[token] }
    },
    signOut: async () => undefined,
  },
}))
const { recovery } = await import('./recovery.svelte')
const { DEFAULT_DAYS, DEFAULT_MINUTES } = await import('../../snapshots/src/api')
const MINUTE = 60 * 1000
beforeEach(() => {
  vi.useFakeTimers()
  sent.calls = []
  open.notes = []
  recovery.setEvery(DEFAULT_MINUTES)
  recovery.setDays(DEFAULT_DAYS)
  localStorage.clear()
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
    expect(sent.calls).toEqual([{ command: 'snapshot_note', args: { path: '/notes/a.md', content: 'one, typed' } }])
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
describe('another window', () => {
  test('choosing how long versions are kept is what this window sweeps by', () => {
    const stop = recovery.start()
    sent.calls = []
    localStorage.setItem('orden:recovery', JSON.stringify({ every: 0, days: 30 }))
    recovery.heard()
    stop()
    expect(recovery.days).toBe(30)
    expect(recovery.every).toBe(0)
    expect(sent.calls).toContainEqual({ command: 'purge_snapshots', args: { days: 30 } })
  })
})
describe('another account in the same window (#2344)', () => {
  test('starts from its own choices or the defaults and none of the last account’s, and the same account again keeps its own', async () => {
    const { account } = await import('../../accounts/src/account.svelte')
    const signedIn = async (who: string) => {
      await account.signOut()
      account.token = who
      account.user = { id: who, email: `${who}@example.org`, name: who }
    }
    server.settings = {}
    await signedIn('alice')
    recovery.receive({ recoveryEvery: 1, recoveryDays: 30 })
    expect(recovery.days).toBe(30)
    await signedIn('bob')
    recovery.receive({})
    expect(recovery.every).toBe(DEFAULT_MINUTES)
    expect(recovery.days).toBe(DEFAULT_DAYS)
    expect(localStorage.getItem('orden:recovery')).toBe(JSON.stringify({ every: DEFAULT_MINUTES, days: DEFAULT_DAYS }))
    recovery.setDays(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(server.settings.bob).toEqual({ recoveryDays: 1 })
    await signedIn('bob')
    recovery.receive({})
    expect(recovery.days).toBe(1)
    await signedIn('alice')
    recovery.receive({ recoveryEvery: 1, recoveryDays: 30 })
    expect(recovery.every).toBe(1)
    expect(recovery.days).toBe(30)
    await signedIn('bob')
    recovery.receive({ recoveryDays: 1 })
    expect(recovery.every).toBe(DEFAULT_MINUTES)
    account.token = null
    account.user = null
  })
  test('what an account still owes from this device comes back with it and reaches it as it was, not as the next account left it', async () => {
    const { account } = await import('../../accounts/src/account.svelte')
    const signedIn = async (who: string) => {
      await account.signOut()
      account.token = who
      account.user = { id: who, email: `${who}@example.org`, name: who }
    }
    server.settings = {}
    await signedIn('alice')
    recovery.receive({})
    server.offline = true
    recovery.setDays(30)
    await vi.advanceTimersByTimeAsync(0)
    server.offline = false
    await signedIn('bob')
    recovery.receive({})
    expect(recovery.days).toBe(DEFAULT_DAYS)
    recovery.setDays(1)
    await signedIn('alice')
    recovery.receive({})
    expect(recovery.days).toBe(30)
    await vi.advanceTimersByTimeAsync(0)
    expect(server.settings.alice).toEqual({ recoveryDays: 30 })
    expect(recovery.days).toBe(30)
    account.token = null
    account.user = null
  })
})
