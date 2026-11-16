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

describe('a locked note or folder copied to a path too long to keep', () => {
  test('lands locked, by its own lock or the folder above it, and stays so after a start', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
    protection.set(ROOT, `${ROOT}/Private`, 'password')
    protection.copied(`${ROOT}/Diary.md`, `${ROOT}/${deep}/Diary.md`, ROOT, ROOT)
    protection.copied(`${ROOT}/Private/Plan.md`, `${ROOT}/${deep}/Plan.md`, ROOT, ROOT)
    protection.copied(`${ROOT}/Private`, `${ROOT}/${deep}/Private copy`, ROOT, ROOT)
    for (const one of [new Protection(), protection]) {
      expect(one.agentsMay(`${ROOT}/${deep}/Diary.md`)).toBe(false)
      expect(one.agentsMay(`${ROOT}/${deep}/Plan.md`)).toBe(false)
      expect(one.agentsMay(`${ROOT}/${deep}/Private copy/Plan.md`)).toBe(false)
    }
  })

  test('locked by the reader there, stays locked', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/${deep}/Diary.md`, 'password')
    expect(new Protection().agentsMay(`${ROOT}/${deep}/Diary.md`)).toBe(false)
  })
})

