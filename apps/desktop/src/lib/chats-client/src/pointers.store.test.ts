import { expect, test, vi } from 'vitest'
import { serveSyncStore } from '../../../../test/sync-store'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))
const store = vi.hoisted(() => ({
  remoteIdFor: () => 'remote-away',
  wrote: () => undefined,
  nudge: () => undefined,
  pass: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../sync-store/src/api', () => ({ sync: store }))
serveSyncStore(store)
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  makeChat: async () => ({ chat: 'new-chat', space: 'remote-away' }),
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../../workspace/src/api')
const { makePointer } = await import('./pointers')
test("a chat made for a note of another space steps past that space's Chat.chat", async () => {
  const files = disk.current?.files ?? new Map<string, string>()
  files.set('/away/Chat.chat', 'the other chat\n')
  files.set('/home/A.md', '# A\n')
  workspace.spaces = [
    { id: 'home', name: 'Home', root: '/home' },
    { id: 'away', name: 'Away', root: '/away' },
  ]
  workspace.activeSpaceId = 'home'
  await workspace.loadTree()
  const place = await makePointer('/away', 'Chat')
  expect(place?.path).toBe('/away/Chat 2.chat')
  expect(files.get('/away/Chat.chat')).toBe('the other chat\n')
})
test('a new chat’s pointer is sent at once, so another device names it even if this one closes soon after (#2269)', async () => {
  store.pass.mockClear()
  workspace.spaces = [{ id: 'away', name: 'Away', root: '/away' }]
  const place = await makePointer('/away', 'Launch')
  expect(place?.path).toBe('/away/Launch.chat')
  expect(store.pass).toHaveBeenCalledTimes(1)
})
test('the chats under a path being deleted are read from the pointers on disk, listed or not (#2321)', async () => {
  const { chatsUnder } = await import('./pointers')
  const PLAN = `c_${'1'.repeat(32)}`
  const TALK = `c_${'2'.repeat(32)}`
  const files = disk.current?.files ?? new Map<string, string>()
  files.set('/away/Work/Plan.chat', `{"v":1,"chat":"${PLAN}"}\n`)
  files.set('/away/Work/Deep/Talk.chat', `{"v":1,"chat":"${TALK}"}\n`)
  files.set('/away/Work/Notes.md', '# Notes\n')
  expect(await chatsUnder('/away/Work/Plan.chat')).toEqual([PLAN])
  expect((await chatsUnder('/away/Work')).sort()).toEqual([PLAN, TALK])
  expect(await chatsUnder('/away/Work/Notes.md')).toEqual([])
})
