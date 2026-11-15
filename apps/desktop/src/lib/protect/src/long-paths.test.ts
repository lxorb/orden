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

const { Protection } = await import('./protection.svelte')

const ROOT = '/space'
const deep = `${'Projects '.repeat(20).trim()}/${'Quarterly notes '.repeat(12).trim()}`

beforeEach(() => localStorage.clear())

describe('a locked note moved to a path too long to keep', () => {
  test('stays locked after the app starts again, under the folder above it that fits', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
    protection.moved(`${ROOT}/Diary.md`, `${ROOT}/${deep}/Diary.md`, ROOT)
    expect(`${deep}/Diary.md`.length).toBeGreaterThan(300)
    const again = new Protection()
    expect(again.locked(`${ROOT}/${deep}/Diary.md`)).toBe(true)
    expect(again.agentsMay(`${ROOT}/${deep}/Diary.md`)).toBe(false)
  })

  test('stays locked when the account answers with the map it was sent', () => {
    const protection = new Protection()
    protection.adopt(ROOT, { 'Diary.md': 'password' }, 'u1')
    protection.moved(`${ROOT}/Diary.md`, `${ROOT}/${deep}/Diary.md`, ROOT)
    protection.said(ROOT, true)
    protection.adopt(ROOT, protection.ways(ROOT), 'u1')
    expect(protection.locked(`${ROOT}/${deep}/Diary.md`)).toBe(true)
  })
})
