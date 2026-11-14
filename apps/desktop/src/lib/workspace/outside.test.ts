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

const asked = vi.hoisted(() => [] as { command: string; args?: unknown }[])
const answer = vi.hoisted((): { taken: unknown } => ({ taken: null }))
vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  invoke: (command: string, args?: unknown) => {
    asked.push({ command, args })
    if (command === 'take_in_outside') return Promise.resolve(answer.taken)
    return Promise.resolve(0)
  },
}))

const { takeIn } = await import('./outside')
const { movedRoot, ROOTS_MOVED, rootsMoved } = await import('./roots-moved')
const { OUTSIDE } = await import('../surfaces.svelte')

const SESSION = JSON.stringify({
  spaces: [{ id: 'kept-id', name: 'Work', root: '/Vault/Work' }],
  tabs: [{ path: '/Vault/Work/Plans.md' }],
})

beforeEach(() => {
  localStorage.clear()
  asked.length = 0
})

describe('a folder outside, taken in', () => {
  test('is followed by everything stored under each space, once, and then settled', async () => {
    localStorage.setItem('orden:workspace', SESSION)
    localStorage.setItem('orden:recent', JSON.stringify(['/Vault/Workshop/a.md']))
    answer.taken = {
      folder: '/Vault',
      moved: [{ from: '/Vault/Work', to: '/Spaces/Work 2' }],
      left: [],
    }

    expect(await takeIn()).toBe(true)

    const session = JSON.parse(localStorage.getItem('orden:workspace') ?? '{}') as {
      spaces: { id: string; root: string }[]
      tabs: { path: string }[]
    }
    expect(session.spaces).toEqual([{ id: 'kept-id', name: 'Work', root: '/Spaces/Work 2' }])
    expect(session.tabs).toEqual([{ path: '/Spaces/Work 2/Plans.md' }])
    expect(localStorage.getItem('orden:recent')).toBe(JSON.stringify(['/Vault/Workshop/a.md']))
    expect(asked).toContainEqual({
      command: 'rehome_snapshots',
      args: { from: '/Vault/Work', to: '/Spaces/Work 2' },
    })
    expect(rootsMoved()).toEqual([{ from: '/Vault/Work', to: '/Spaces/Work 2' }])
    expect(JSON.parse(localStorage.getItem(OUTSIDE) ?? 'null')).toEqual({
      folder: '/Vault',
      left: [],
    })
    expect(asked.map((one) => one.command)).toContain('settle_outside')
  })

  test('starts the page over where the spaces came in, even with nothing stored of them', async () => {
    answer.taken = { folder: '/Vault', moved: [{ from: '/Vault/A', to: '/Spaces/A' }], left: [] }
    expect(await takeIn()).toBe(true)
  })

  test('is not settled while a space of it could not be copied, nor started over twice', async () => {
    localStorage.setItem('orden:workspace', SESSION)
    answer.taken = {
      folder: '/Vault',
      moved: [{ from: '/Vault/Work', to: '/Spaces/Work 2' }],
      left: ['Home'],
    }

    expect(await takeIn()).toBe(true)
    expect(await takeIn()).toBe(false)

    expect(asked.map((one) => one.command)).not.toContain('settle_outside')
    expect(rootsMoved()).toEqual([{ from: '/Vault/Work', to: '/Spaces/Work 2' }])
    expect(JSON.parse(localStorage.getItem(OUTSIDE) ?? 'null')).toEqual({
      folder: '/Vault',
      left: ['Home'],
    })
  })

  test('is nothing where the crate has nothing to take in', async () => {
    answer.taken = null
    expect(await takeIn()).toBe(false)
    expect(localStorage.getItem(OUTSIDE)).toBeNull()
    expect(localStorage.getItem(ROOTS_MOVED)).toBeNull()
  })
})

describe('a root that moved', () => {
  test('is the root itself or anything under it, never one beside it', () => {
    const moves = [{ from: '/Vault/Work', to: '/Spaces/Work 2' }]
    expect(movedRoot('/Vault/Work', moves)).toBe('/Spaces/Work 2')
    expect(movedRoot('/Vault/Work/inner', moves)).toBe('/Spaces/Work 2/inner')
    expect(movedRoot('/Vault/Workshop', moves)).toBeNull()
  })
})
