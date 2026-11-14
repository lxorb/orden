import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Fake {
  saved: unknown
  deleted: string[]
  nudged: number
  user: { id: string } | null
}

const fake = vi.hoisted((): Fake => ({
  saved: null,
  deleted: [],
  nudged: 0,
  user: { id: 'u1' },
}))

vi.mock('../platform/src/stored', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/stored')>()),
  stored: () => fake.saved,
}))
vi.mock('../accounts/src/account.svelte', () => ({
  account: {
    get user() {
      return fake.user
    },
    accountToken: 'token',
  },
}))
vi.mock('../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../accounts/src/client')>()),
  api: {
    deleteNote: (_token: string, id: string) => {
      fake.deleted.push(id)
      return Promise.resolve({ ok: true })
    },
  },
}))
vi.mock('../sync.svelte', () => ({
  STORAGE_KEY: 'orden:mirrors',
  sync: {
    nudge: () => {
      fake.nudged++
    },
  },
}))

const { syncedCopies } = await import('./synced')

const CLASH = 'Plan (# Name clash 2026-10-05 a1b2c3C #).md'
const tracked = (id: string) => ({ id, version: 1, hash: 'h' })

beforeEach(() => {
  fake.deleted.length = 0
  fake.nudged = 0
  fake.user = { id: 'u1' }
  fake.saved = {
    account: 'u1',
    mirrors: {
      '/Notes': {
        spaceId: 's1',
        notes: {
          'Plan.md': tracked('n1'),
          [CLASH]: tracked('n2'),
          'Old (conflicted copy 2026-10-05 093612)/inside.md': tracked('n3'),
        },
      },
      '/Work': { spaceId: 's2', notes: { 'Report-DESKTOP-4F2K9QX.md': tracked('n4') } },
    },
  }
})

describe('under v1', () => {
  test('counts the copies the mirrors track, in every space', () => {
    expect(syncedCopies(null).count).toBe(3)
  })

  test('takes each off the account and nothing else, then asks for a pass', async () => {
    await syncedCopies(null).remove()

    expect(fake.deleted).toEqual(['n2', 'n3', 'n4'])
    expect(fake.nudged).toBe(1)
  })

  test('counts none of another account’s', () => {
    fake.user = { id: 'u2' }

    expect(syncedCopies(null).count).toBe(0)
  })
})

describe('under v2', () => {
  test('asks the engine, which knows its tree', async () => {
    const unsync = vi.fn(() => Promise.resolve(2))
    const engine = {
      held: { notes: [], answer: () => Promise.resolve(undefined) },
      store: { read: () => Promise.reject(new Error('unused')) },
      on: () => () => undefined,
      copies: { foreignCopies: () => [{}, {}], unsync },
    }

    const copies = syncedCopies(engine)
    expect(copies.count).toBe(2)
    await copies.remove()

    expect(unsync).toHaveBeenCalledOnce()
    expect(fake.deleted).toEqual([])
    expect(fake.nudged).toBe(1)
  })
})
