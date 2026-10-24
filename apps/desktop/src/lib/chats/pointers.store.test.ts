import { expect, test, vi } from 'vitest'

/** A new chat's pointer is written beside the note it is for, which can be in a space
 *  that is not on screen. Its name was chosen from the listing on screen, so a chat
 *  made there was written over that space's own `Chat.chat`, another chat's pointer. */

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))
vi.mock('../sync.svelte', () => ({
  sync: { remoteIdFor: () => 'remote-away', wrote: () => undefined, nudge: () => undefined },
}))
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  makeChat: async () => ({ chat: 'new-chat', space: 'remote-away' }),
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
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
