import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Lock } from './protection.svelte'
import { NEVER, unlocks } from './unlocked.svelte'

const NOTE: Lock = { root: '/space', key: 'Plans.md', way: 'password' }
const FOLDER: Lock = { root: '/space', key: 'Inside', way: 'device' }

beforeEach(() => {
  vi.useFakeTimers()
  unlocks.lockAll()
  unlocks.relock = 5
})

afterEach(() => vi.useRealTimers())

describe('a lock', () => {
  test('is shut until it is opened', () => {
    expect(unlocks.shut([NOTE])).toBe(true)
    unlocks.unlock([NOTE])
    expect(unlocks.shut([NOTE])).toBe(false)
  })

  test('in front of a path keeps it shut while any one of them is', () => {
    unlocks.unlock([NOTE])
    expect(unlocks.shut([NOTE, FOLDER])).toBe(true)
  })

  test('closes on its own, or with every other', () => {
    unlocks.unlock([NOTE, FOLDER])
    unlocks.close([NOTE])
    expect(unlocks.shut([NOTE])).toBe(true)
    expect(unlocks.shut([FOLDER])).toBe(false)
    unlocks.lockAll()
    expect(unlocks.any).toBe(false)
  })

  test('follows its path when that is renamed', () => {
    unlocks.unlock([FOLDER])
    unlocks.moved('/space/Inside', '/space/Moved', '/space')
    expect(unlocks.shut([{ ...FOLDER, key: 'Moved' }])).toBe(false)
  })
})

describe('locking again', () => {
  test('waits the minutes chosen once the window is away', () => {
    unlocks.unlock([NOTE])
    unlocks.away()
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(unlocks.any).toBe(true)
    vi.advanceTimersByTime(1)
    expect(unlocks.any).toBe(false)
  })

  test('does not happen when the window is back in time', () => {
    unlocks.unlock([NOTE])
    unlocks.away()
    vi.advanceTimersByTime(60_000)
    unlocks.back()
    vi.advanceTimersByTime(60 * 60_000)
    expect(unlocks.any).toBe(true)
  })

  test('is at once where the reader chose so', () => {
    unlocks.relock = 0
    unlocks.unlock([NOTE])
    unlocks.away()
    expect(unlocks.any).toBe(false)
  })

  test('waits for a restart where the reader chose so', () => {
    unlocks.relock = NEVER
    unlocks.unlock([NOTE])
    unlocks.away()
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(unlocks.any).toBe(true)
  })
})

describe('agents', () => {
  test('read nothing protected until it is open and the reader lets them', () => {
    expect(unlocks.agentsMay([NOTE])).toBe(false)
    unlocks.letAgents([NOTE], true)
    expect(unlocks.agentsMay([NOTE])).toBe(false)
    unlocks.unlock([NOTE])
    expect(unlocks.agentsMay([NOTE])).toBe(false)
    unlocks.letAgents([NOTE], true)
    expect(unlocks.agentsMay([NOTE])).toBe(true)
  })

  test('lose what they were let read as soon as it locks again', () => {
    unlocks.unlock([NOTE])
    unlocks.letAgents([NOTE], true)
    unlocks.lockAll()
    unlocks.unlock([NOTE])
    expect(unlocks.agentsMay([NOTE])).toBe(false)
  })
})
