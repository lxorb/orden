import { beforeEach, describe, expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  offline: false,
  refuses: null as string | null,
}))

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})

vi.mock('./client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./client')>()
  return {
    ...original,
    api: {
      saveSettings: (_token: string, patch: Record<string, unknown>) => {
        if (server.offline) return Promise.reject(new Error('offline'))
        if (server.refuses !== null && server.refuses in patch) {
          return Promise.reject(new original.ApiError(400, 'refused'))
        }
        server.sent.push(patch)
        return Promise.resolve({ settings: patch })
      },
    },
  }
})

const { account } = await import('./account.svelte')
const { AccountOwed } = await import('./account-owed')

const owed = new AccountOwed('orden:test-owed')

beforeEach(() => {
  held.clear()
  server.sent = []
  server.offline = false
  server.refuses = null
  account.token = 'token'
  account.user = { id: 'u1' } as typeof account.user
})

describe('what is owed to the account', () => {
  test('gathers every change made while it could not hear, and sends them together', async () => {
    server.offline = true
    owed.send({ vim: true })
    owed.send({ ligatures: 'code' })
    await vi.waitFor(() => expect(owed.standing).toBe(true))

    server.offline = false
    await owed.settle('token')

    expect(server.sent).toEqual([{ vim: true, ligatures: 'code' }])
    expect(owed.standing).toBe(false)
  })

  test('lets go of a change the account turns down without losing the rest', async () => {
    server.offline = true
    owed.send({ vim: true, ligatures: 'code' })
    server.offline = false
    server.refuses = 'ligatures'
    await owed.settle('token')

    expect(server.sent).toEqual([{ vim: true }])
    expect(owed.standing).toBe(false)
  })

  test('counts every change, so a reader can tell one came in while it waited', () => {
    const before = owed.sends
    owed.send({ silent: true })
    expect(owed.sends).toBe(before + 1)
  })
})
