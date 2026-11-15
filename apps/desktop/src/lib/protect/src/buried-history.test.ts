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
    await protection.gone('/s/Diary.md', '/s', 'trash-1')
    await settled()
    expect(rehomed).toEqual([
      expect.stringMatching(/^\/s\/Diary\.md -> \/\.orden-locked-history\//),
    ])
  })

  test('come back with it, where it is put back', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Private', 'password')
    await protection.gone('/s/Private', '/s', 'trash-2')
    await settled()
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.cameBack('/s/Private 2', '/s', 'trash-2')
    expect(rehomed[1]).toBe(`${away} -> /s/Private 2`)
    expect(protection.own('/s', '/s/Private 2')?.way).toBe('password')
  })

  test('come back when the account puts the note back', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'device')
    await protection.gone('/s/Diary.md', '/s')
    await settled()
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.unbury(null, '/s', 'Diary.md')
    expect(rehomed[1]).toBe(`${away} -> /s/Diary.md`)
  })

  test('of a note nothing locks, stay where they are', async () => {
    const protection = new Protection()
    await protection.gone('/s/Plan.md', '/s', 'trash-3')
    await settled()
    expect(rehomed).toEqual([])
  })

  test('of a note put back by the account from a deleted locked folder, come back with the lock', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Private', 'password')
    protection.set('/s', '/s/Private/Deep/Diary.md', 'device')
    await protection.gone('/s/Private', '/s', 'gone-folder')
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.unbury(null, '/s', 'Private/Deep/Diary.md')
    expect(protection.ways('/s')).toEqual({
      Private: 'password',
      'Private/Deep/Diary.md': 'device',
    })
    expect(rehomed[1]).toBe(`${away}/Deep/Diary.md -> /s/Private/Deep/Diary.md`)
  })

  test('come back where something put back under another trash id lands at its place', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Private', 'password')
    await protection.gone('/s/Private', '/s')
    await protection.cameBack('/s/Private', '/s', 'an-id-it-was-never-told')
    expect(protection.own('/s', '/s/Private')?.way).toBe('password')
  })

  test('of a space that goes without a trash id, leave its place too', async () => {
    const protection = new Protection()
    protection.set('/s', '/s', 'password')
    await protection.forget('/s')
    expect(rehomed).toEqual([expect.stringMatching(/^\/s -> \/\.orden-locked-history\//)])
  })

  test('are away before the lock is gone', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'password')
    const going = protection.gone('/s/Diary.md', '/s', 'trash-9')
    expect(protection.own('/s', '/s/Diary.md')?.way).toBe('password')
    await going
    expect(rehomed).toHaveLength(1)
    expect(protection.own('/s', '/s/Diary.md')).toBeNull()
  })
  test('of a note deleted from a locked folder, come back locked after the folder is renamed', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Private', 'password')
    await protection.gone('/s/Private/Diary.md', '/s', 'trash-in')
    protection.moved('/s/Private', '/s/Open', '/s')
    await protection.cameBack('/s/Private/Diary.md', '/s', 'trash-in')
    expect(protection.locked('/s/Private/Diary.md')).toBe(true)
  })

  test('come back where the account puts the note back under another name', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'password')
    await protection.gone('/s/Diary.md', '/s')
    const away = rehomed[0]?.split(' -> ')[1]
    await protection.unbury(null, '/s', 'Diary 2.md', 'Diary.md')
    expect(protection.own('/s', '/s/Diary 2.md')?.way).toBe('password')
    expect(rehomed[1]).toBe(`${away} -> /s/Diary 2.md`)
  })

  test('follow their space when it is renamed', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'device')
    await protection.gone('/s/Diary.md', '/s')
    protection.spaceMoved('/s', '/t')
    await settled()
    await protection.unbury(null, '/t', 'Diary.md')
    expect(protection.own('/t', '/t/Diary.md')?.way).toBe('device')
  })
  test('of two locked notes deleted from one place, each come back locked when the account puts them back', async () => {
    const protection = new Protection()
    protection.set('/s', '/s/Diary.md', 'password')
    await protection.gone('/s/Diary.md', '/s', 'account-delete-1')
    protection.set('/s', '/s/Diary.md', 'device')
    await protection.gone('/s/Diary.md', '/s', 'account-delete-2')
    await protection.unbury(null, '/s', 'Diary.md')
    await protection.unbury(null, '/s', 'Diary 2.md', 'Diary.md')
    expect(protection.own('/s', '/s/Diary.md')).not.toBeNull()
    expect(protection.own('/s', '/s/Diary 2.md')).not.toBeNull()
    expect(new Set(rehomed.slice(2).map((one) => one.split(' -> ')[0])).size).toBe(2)
  })
})
