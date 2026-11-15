import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./synced', () => ({
  pushWays: () => Promise.resolve(),
  pushPassword: () => Promise.resolve(),
}))

const { protection, STORAGE_KEY } = await import('./protection.svelte')
const { unlocks } = await import('./unlocked.svelte')

const ROOT = '/space'

function anotherWindowWrote(key: string, value: string) {
  localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

describe('protection set in another window', () => {
  afterEach(() => {
    protection.set(ROOT, `${ROOT}/Inside`, null)
    protection.set(ROOT, `${ROOT}/Plans.md`, null)
    localStorage.clear()
  })

  test('locks here too, and is kept when this window protects something else', () => {
    const other = { [ROOT]: { ways: { Inside: 'password' }, account: null, sent: false } }
    anotherWindowWrote(STORAGE_KEY, JSON.stringify(other))
    expect(protection.locked(`${ROOT}/Inside/Diary.md`)).toBe(true)

    protection.set(ROOT, `${ROOT}/Plans.md`, 'password')
    expect(protection.ways(ROOT)).toEqual({ Inside: 'password', 'Plans.md': 'password' })
  })

  test('brings its password, so this window does not ask for a new one', () => {
    const hashed = { n: 16384, r: 8, p: 1, salt: 'c2FsdA==', hash: 'aGFzaA==', at: 1 }
    anotherWindowWrote('orden:protect-password', JSON.stringify(hashed))
    expect(protection.password).not.toBeNull()
  })
})

describe('a shorter relock chosen in another window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    unlocks.lockAll()
    unlocks.relock = 60
  })

  afterEach(() => {
    unlocks.lockAll()
    vi.useRealTimers()
    localStorage.clear()
  })

  test('relocks this window, already away, by the new time', () => {
    unlocks.unlock([{ root: ROOT, key: 'Plans.md', way: 'password' }])
    unlocks.away()

    anotherWindowWrote('orden:protect-relock', '1')
    expect(unlocks.relock).toBe(1)
    vi.advanceTimersByTime(61_000)

    expect(unlocks.any).toBe(false)
  })
})
