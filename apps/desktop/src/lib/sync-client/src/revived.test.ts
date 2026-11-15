import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: async () => 0,
}))

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

const { protection } = await import('../../protect/src/api')
const { revived } = await import('./revived')

beforeEach(() => localStorage.clear())

describe('a locked note deleted here that sync brings back', () => {
  test('is locked again, because an edit elsewhere beat the delete', async () => {
    protection.set('/s', '/s/Diary.md', 'password')
    await protection.gone('/s/Diary.md', '/s', 'n1')
    expect(protection.locked('/s/Diary.md')).toBe(false)
    await revived('/s/Diary.md', 'n1', ['/s'])
    expect(protection.locked('/s/Diary.md')).toBe(true)
    protection.set('/s', '/s/Diary.md', null)
  })

  test('but a new note another device made at that name does not take the lock away from the one deleted', async () => {
    protection.set('/s', '/s/Diary.md', 'password')
    await protection.gone('/s/Diary.md', '/s', 'n1')
    await revived('/s/Diary.md', 'n2', ['/s'])
    expect(protection.locked('/s/Diary.md')).toBe(false)
    await protection.cameBack('/s/Diary 2.md', '/s', 'n1')
    expect(protection.locked('/s/Diary 2.md')).toBe(true)
    protection.set('/s', '/s/Diary 2.md', null)
  })
})
