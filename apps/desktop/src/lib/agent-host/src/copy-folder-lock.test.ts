import { beforeEach, describe, expect, test, vi } from 'vitest'

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
const { readableAll } = await import('./guarded')

const ROOT = '/space'
const ORIGINAL = `${ROOT}/Work`

describe.each([`${ROOT}/Work (# Name clash 2026-11-15 abc1234 #)`, `${ROOT}/Work-DESKTOP-AB12CD3`])(
  'a sync tool’s copy %s of a folder holding a locked note',
  (copy) => {
    beforeEach(() => {
      localStorage.clear()
      for (const key of Object.keys(protection.ways(ROOT)))
        protection.set(ROOT, `${ROOT}/${key}`, null)
      protection.set(ROOT, `${ORIGINAL}/Secret.md`, 'password')
    })

    test('may not be moved or deleted by an agent', () => {
      expect(() => readableAll(copy, copy)).toThrow(/protected/)
    })

    test('keeps the note inside locked when it moves', () => {
      protection.moved(copy, `${ROOT}/Moved`, ROOT)
      expect(protection.agentsMay(`${ROOT}/Moved/Secret.md`)).toBe(false)
      expect(protection.locked(`${ROOT}/Moved/Secret.md`)).toBe(true)
      expect(protection.agentsMay(`${ORIGINAL}/Secret.md`)).toBe(false)
    })

    test('locks the note inside its duplicate', () => {
      protection.copied(copy, `${ROOT}/Copied`, ROOT, ROOT)
      expect(protection.agentsMay(`${ROOT}/Copied/Secret.md`)).toBe(false)
    })
  },
)
