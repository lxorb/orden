import { expect, test, vi } from 'vitest'
import { serveSyncStore } from '../../../../test/sync-store'

const asked = vi.hoisted(() => ({ shared: [] as string[], reached: [] as string[] }))
const store = vi.hoisted(() => ({
  remoteIdFor: (root: string) => (root === '/space' ? 'space-1' : null),
  nudge: () => undefined,
  tracked: (path: string) => ({ id: `note:${path}` }),
  roleKept: () => null,
}))
vi.mock('../../sync-store/src/api', () => ({ sync: store }))
serveSyncStore(store)
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  noteReachOf: (_chat: string, _space: string, note: string) => {
    asked.reached.push(note)
    return Promise.resolve({ missing: [{ who: 'user:bo', name: 'Bo', role: 'write' }], share: true })
  },
  shareNote: (_chat: string, _space: string, note: string) => {
    asked.shared.push(note)
    return Promise.resolve(true)
  },
}))
const { chats } = await import('./store.svelte')
const { workspace } = await import('../../workspace/src/api')
const { FixtureChats } = await import('./view/fixture.svelte')

test('a web note is never shared into a chat: nothing asks the server, and Share is never offered for it (#2475)', async () => {
  workspace.spaces = [{ id: 'space-1', name: 'Space', root: '/space' }]
  expect(await chats.shareNote('c1', '/space/Docs.url')).toBe(false)
  expect(await chats.shareNote('c1', '/space/Site.URL')).toBe(false)
  expect(asked.shared).toEqual([])
  expect((await chats.noteReach('c1', '/space/Docs.url'))?.share).toBe(false)
  expect(await chats.shareNote('c1', '/space/Plan.md')).toBe(true)
  expect(asked.shared).toEqual(['note:/space/Plan.md'])
  expect((await chats.noteReach('c1', '/space/Plan.md'))?.share).toBe(true)
  const fixture = new FixtureChats('user:me')
  expect(await fixture.shareNote('c1', '/space/Docs.url')).toBe(false)
})
