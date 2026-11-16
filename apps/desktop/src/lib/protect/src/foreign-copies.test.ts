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
const NOTE = `${ROOT}/Diary.md`
const DROPBOX = `${ROOT}/Diary (Laptop's conflicted copy 2026-11-15).md`
const SYNCTHING = `${ROOT}/Diary.sync-conflict-20261115-101010-ABCDEFG.md`

beforeEach(() => localStorage.clear())

const beside = (protection: InstanceType<typeof Protection>) =>
  protection.seesFiles(() => [NOTE, DROPBOX, SYNCTHING])

describe('a foreign sync tool copy beside a locked note', () => {
  test('is locked while the note keeps its name', () => {
    const protection = new Protection()
    protection.set(ROOT, NOTE, 'password')
    expect(protection.locked(DROPBOX)).toBe(true)
    expect(protection.agentsMay(SYNCTHING)).toBe(false)
  })

  test('stays locked when the locked note is renamed or moved into another folder', () => {
    const protection = new Protection()
    beside(protection)
    protection.set(ROOT, NOTE, 'password')
    protection.moved(NOTE, `${ROOT}/Old/Diary.md`, ROOT)
    expect(protection.locked(`${ROOT}/Old/Diary.md`)).toBe(true)
    expect(protection.locked(DROPBOX)).toBe(true)
    expect(new Protection().agentsMay(SYNCTHING)).toBe(false)
  })

  test('stays locked when the locked note is deleted', async () => {
    const protection = new Protection()
    beside(protection)
    protection.set(ROOT, NOTE, 'password')
    await protection.gone(NOTE, ROOT, 'trash-1')
    expect(protection.agentsMay(DROPBOX)).toBe(false)
    expect(protection.agentsMay(SYNCTHING)).toBe(false)
  })
})
