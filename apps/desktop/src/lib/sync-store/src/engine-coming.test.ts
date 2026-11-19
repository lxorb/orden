import { providePort, type SyncWorkspacePort } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})
const asked: string[] = []
vi.stubGlobal('fetch', (url: string) => {
  asked.push(url.slice(url.indexOf('/v')))
  return Promise.resolve(new Response(JSON.stringify({ spaces: [] }), { status: 200 }))
})
const paired: string[] = []
providePort('sync.workspace', {
  spaces: [{ id: 'n', root: '/spaces/Notes', name: 'Notes' }],
} as unknown as SyncWorkspacePort)
providePort('sync.pairing', {
  pairSpaces: (token: string) => {
    paired.push(token)
    return Promise.resolve()
  },
})
const { account } = await import('../../accounts/src/api')
const { sync } = await import('./sync.svelte')
const listening = { addEventListener: () => undefined, removeEventListener: () => undefined }
vi.stubGlobal('document', { ...listening, hidden: false })
vi.stubGlobal('window', listening)
describe('a pass asked for while the second sync engine is still loading', () => {
  test('waits for that engine instead of pairing and syncing as the first one', async () => {
    vi.useFakeTimers()
    account.token = 'session'
    account.user = { id: 'u1', email: 'one@example.com', name: 'One', syncVersion: 2 }
    sync.start()
    expect(sync.version).toBe(2)
    expect(await sync.pass()).toBe(false)
    expect(paired).toEqual([])
    expect(asked).toEqual([])
    expect(held.has('orden:mirrors')).toBe(false)
    sync.stop()
    vi.useRealTimers()
  })
  test('runs as the first engine again once an account on it signs in after one on the second', async () => {
    vi.useFakeTimers()
    account.token = 'other'
    account.user = { id: 'u2', email: 'two@example.com', name: 'Two', syncVersion: 1 }
    sync.start()
    await vi.waitFor(() => expect(paired).toEqual(['other']))
    expect(sync.version).toBe(1)
    sync.stop()
    vi.useRealTimers()
  })
})
