import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
let reachable = false
vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
  asked.push(`${init.method} ${url.slice(url.indexOf('/v1/'))} ${init.body as string}`)
  if (!reachable) return Promise.reject(new TypeError('Failed to fetch'))
  return Promise.resolve(new Response(JSON.stringify({ space: { id: 's1' } }), { status: 200 }))
})

const { account } = await import('../../accounts/src/api')
const { settleNames } = await import('../../space-owed/src/api')
const { sync } = await import('./sync.svelte')

const listening = { addEventListener: () => undefined, removeEventListener: () => undefined }
vi.stubGlobal('document', { ...listening, hidden: false })
vi.stubGlobal('window', { ...listening, __TAURI_OS_PLUGIN_INTERNALS__: { platform: 'macos' } })

function mirrorOf(notes: Record<string, { id: string; version: number; hash: string }>) {
  return {
    account: 'u1',
    seen: true,
    mirrors: {
      '/spaces/Work': {
        spaceId: 's1',
        root: '/spaces/Work',
        cursor: 3,
        notes,
        offered: {},
        files: {},
        dropped: false,
        shared: false,
      },
    },
  }
}

describe('the first sync engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    account.token = 'session'
    account.user = { id: 'u1', email: 'one@example.com', name: 'One' }
  })

  afterEach(() => {
    sync.stop()
    vi.useRealTimers()
  })

  test('keeps a new space name owed while the account cannot be reached, and sends it later', async () => {
    held.set('orden:mirrors', JSON.stringify(mirrorOf({})))
    sync.start()

    const sent = 'PATCH /v1/spaces/s1 {"name":"Plans"}'
    await sync.renamed('/spaces/Work', '/spaces/Plans', 'Plans')
    expect(asked).toEqual([sent])
    expect(sync.remoteIdFor('/spaces/Plans')).toBe('s1')

    reachable = true
    await settleNames('session', 'u1')
    expect(asked).toEqual([sent, sent])
    await settleNames('session', 'u1')
    expect(asked).toEqual([sent, sent])
  })

  test('finds a note however a disk that folds case spells the space it is in', () => {
    const note = { id: 'n1', version: 2, hash: 'h' }
    held.set('orden:mirrors', JSON.stringify(mirrorOf({ 'Plan.md': note })))
    sync.start()

    expect(sync.tracked('/spaces/work/Plan.md')?.id).toBe('n1')
  })

  test('rereading what was kept does not bring back the old place of a note that moved', () => {
    const note = { id: 'n1', version: 2, hash: 'h' }
    held.set('orden:mirrors', JSON.stringify(mirrorOf({ 'Later.md': note })))
    sync.start()
    held.set('orden:mirrors', JSON.stringify(mirrorOf({ 'Plan.md': note, 'Other.md': { ...note, id: 'n2' } })))

    sync.reread()

    expect(sync.tracked('/spaces/Work/Later.md')?.id).toBe('n1')
    expect(sync.tracked('/spaces/Work/Plan.md')).toBeNull()
    expect(sync.tracked('/spaces/Work/Other.md')?.id).toBe('n2')
  })
})
