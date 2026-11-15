import { describe, expect, test, vi } from 'vitest'
import { FIRST_SESSION, sessionOf, slotOf, takeSlot } from './slot'

function fakeLocks() {
  const held = new Set<string>()
  return {
    held,
    request(name: string, _options: unknown, run: (lock: object | null) => unknown) {
      if (held.has(name)) return Promise.resolve(run(null))
      held.add(name)
      return Promise.resolve(run({ name }))
    },
  } as unknown as LockManager & { held: Set<string> }
}

describe('a window takes a session of its own', () => {
  test('the first window writes the entry an older build wrote', async () => {
    expect(await takeSlot(fakeLocks())).toBe(0)
    expect(sessionOf(0)).toBe(FIRST_SESSION)
    expect(FIRST_SESSION).toBe('orden:workspace')
  })

  test('the next takes the next, and a slot let go is taken again', async () => {
    const locks = fakeLocks()
    expect(await takeSlot(locks)).toBe(0)
    expect(await takeSlot(locks)).toBe(1)
    expect(await takeSlot(locks)).toBe(2)
    locks.held.delete('orden:window:1')
    expect(await takeSlot(locks)).toBe(1)
    expect(sessionOf(1)).toBe('orden:workspace:1')
  })

  test('without locks there is the one', async () => {
    vi.stubGlobal('navigator', {})
    expect(await takeSlot()).toBe(0)
    vi.unstubAllGlobals()
  })

  test('only a slot entry reads as one', () => {
    expect(slotOf('orden:workspace')).toBe(0)
    expect(slotOf('orden:workspace:3')).toBe(3)
    expect(slotOf('orden:workspace:x')).toBeNull()
    expect(slotOf('orden:workspaces')).toBeNull()
  })
})
