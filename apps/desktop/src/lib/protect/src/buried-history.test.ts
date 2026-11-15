import { beforeEach, describe, expect, test, vi } from 'vitest'

const rehomed: string[] = []
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: async (command: string, args: { from: string; to: string }) => {
    if (command === 'rehome_snapshots') rehomed.push(`${args.from} -> ${args.to}`)
    return 0
  },
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

const { Protection } = await import('./protection.svelte')

const settled = async () => {
  await import('./buried')
  await new Promise((done) => setTimeout(done, 0))
}

beforeEach(() => {
  rehomed.length = 0
  localStorage.clear()
})

describe('the versions of a locked note that is deleted', () => {
  test('leave its place, so a note made there later finds none of them', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'password')
    protection.gone('/s/Diary.md', '/s', 'trash-1')
    await settled()
    expect(rehomed).toEqual([
      expect.stringMatching(/^\/s\/Diary\.md -> \/\.orden-locked-history\//),
    ])
  })

  test('come back with it, where it is put back', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Private', 'password')
    protection.gone('/s/Private', '/s', 'trash-2')
    await settled()
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.cameBack('/s/Private 2', '/s', 'trash-2')
    expect(rehomed[1]).toBe(`${away} -> /s/Private 2`)
    expect(protection.own('/s', '/s/Private 2')?.way).toBe('password')
  })

  test('come back when the account puts the note back', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'device')
    protection.gone('/s/Diary.md', '/s')
    await settled()
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.restoredAt('/s', 'Diary.md')
    expect(rehomed[1]).toBe(`${away} -> /s/Diary.md`)
  })

  test('of a note nothing locks, stay where they are', async () => {
    const protection = new Protection()
    protection.gone('/s/Plan.md', '/s', 'trash-3')
    await settled()
    expect(rehomed).toEqual([])
  })
})
