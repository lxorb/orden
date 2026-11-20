import { providePort, type Bookmark, type SyncWorkspacePort } from '@orden/contracts'
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
const answer: { bookmarks: Bookmark[] } = { bookmarks: [] }
vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(answer), { status: 200 })))
const sent: Bookmark[] = [
  { kind: 'note', path: 'Plan.md', text: 'Plan' },
  { kind: 'search', path: '', text: 'milk' },
]
const said: boolean[] = []
providePort('sync.workspace', {
  spaces: [{ id: 'w', root: '/spaces/Work', name: 'Work' }],
  bookmarksOf: () => sent,
  bookmarksSaid: (_root: string, landed: boolean) => void said.push(landed),
} as unknown as SyncWorkspacePort)
const { account } = await import('../../accounts/src/api')
const { sync } = await import('./sync.svelte')
const listening = { addEventListener: () => undefined, removeEventListener: () => undefined }
vi.stubGlobal('document', { ...listening, hidden: false })
vi.stubGlobal('window', listening)
describe('bookmarks sent to the account (#2329)', () => {
  test('count as sent only when the answer keeps every one of them', async () => {
    held.set(
      'orden:mirrors',
      JSON.stringify({
        account: 'u1',
        seen: true,
        mirrors: {
          '/spaces/Work': {
            spaceId: 's1',
            root: '/spaces/Work',
            cursor: 1,
            notes: {},
            offered: {},
            files: {},
            dropped: false,
            shared: false,
          },
        },
      }),
    )
    vi.useFakeTimers()
    try {
      account.token = 'session'
      account.user = { id: 'u1', email: 'one@example.com', name: 'One', syncVersion: 1 }
      sync.start()
      answer.bookmarks = [sent[0]!]
      await sync.pushBookmarks('/spaces/Work')
      answer.bookmarks = [...sent]
      await sync.pushBookmarks('/spaces/Work')
      expect(said).toEqual([false, true])
    } finally {
      sync.stop()
      vi.useRealTimers()
    }
  })
})
