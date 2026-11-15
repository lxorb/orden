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

const { Protection, protectedMap } = await import('./protection.svelte')

const ROOT = '/space'

beforeEach(() => localStorage.clear())

describe('a locked note whose name begins with a letter and a colon', () => {
  test('is locked when the reader locks it, and after the app starts again', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Q: Diary.md`, 'password')
    expect(new Protection().agentsMay(`${ROOT}/Q: Diary.md`)).toBe(false)
    expect(protectedMap({ 'Q: Diary.md': 'password', 'C:\\x': 'password' })).toEqual({
      'Q: Diary.md': 'password',
    })
  })

  test('keeps its lock when it is moved out of a locked folder or renamed', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Private`, 'password')
    protection.moved(`${ROOT}/Private/Q: Diary.md`, `${ROOT}/Q: Diary.md`, ROOT)
    protection.set(ROOT, `${ROOT}/Work/Plan.md`, 'device')
    protection.moved(`${ROOT}/Work`, `${ROOT}/W: Work`, ROOT)
    const again = new Protection()
    expect(again.locked(`${ROOT}/Q: Diary.md`)).toBe(true)
    expect(again.locked(`${ROOT}/W: Work/Plan.md`)).toBe(true)
  })

  test('is locked when it is copied out of a locked folder', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Private`, 'password')
    protection.copied(`${ROOT}/Private/Q: Plan.md`, `${ROOT}/Q: Plan.md`, ROOT, ROOT)
    expect(new Protection().locked(`${ROOT}/Q: Plan.md`)).toBe(true)
  })
})
