import { expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
})
const { answeredCase, pathKey } = await import('../../platform/src/space-paths')
const { Protection } = await import('./protection.svelte')
test('a lock in a folding space covers every spelling the file system opens as it', () => {
  const ROOT = '/space'
  answeredCase(ROOT, true)
  const protection = new Protection()
  protection.set(ROOT, `${ROOT}/Secrets`, 'password')
  protection.set(ROOT, `${ROOT}/Plans.md`, 'password')
  expect(protection.covering(`${ROOT}/SECRETS/plan.md`)).toHaveLength(1)
  expect(protection.covering(`${ROOT}/ſecrets/plan.md`)).toHaveLength(1)
  expect(protection.agentsMay(`${ROOT}/ſecrets/plan.md`)).toBe(false)
  expect(protection.agentsMay(`${ROOT}/Planſ.md`)).toBe(false)
  expect(pathKey(`${ROOT}/ſecrets`)).toBe(pathKey(`${ROOT}/Secrets`))
  expect(pathKey(`${ROOT}/Straße`)).not.toBe(pathKey(`${ROOT}/Strasse`))
  answeredCase(ROOT, null)
})
test('a lock in a folding space stays shut however its letters fold, in the app as for agents', () => {
  for (const ROOT of ['/Users/eleni/Σημειώσεις', '/space']) {
    answeredCase(ROOT, true)
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Diary`, 'password')
    protection.set(ROOT, `${ROOT}/İş`, 'password')
    protection.set(ROOT, `${ROOT}/Λόγος`, 'password')
    protection.set(ROOT, `${ROOT}/Secrets`, 'password')
    for (const path of [
      'Diary/today.md',
      'İş/plan.md',
      'Λόγος/a.md',
      'ΛΌΓΟΣ/a.md',
      'Secrets/plan.md',
      'ſecrets/plan.md',
    ]) {
      expect(protection.locked(`${ROOT}/${path}`), `${ROOT} ${path}`).toBe(true)
    }
    expect(protection.locked(`${ROOT}/Open/plan.md`)).toBe(false)
    answeredCase(ROOT, null)
  }
})
