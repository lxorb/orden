import { portProvided } from '@orden/contracts'
import { beforeEach, expect, test, vi } from 'vitest'

const CHAT = `c_${'1'.repeat(32)}`
const OTHER = `c_${'2'.repeat(32)}`
const disk = vi.hoisted(() => ({ asked: [] as string[] }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: (command: string) => {
    disk.asked.push(command)
    return Promise.resolve()
  },
}))
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  listChats: async () => {
    const { chatRow } = await import('./test-account')
    return {
      chats: [
        chatRow(CHAT, { space: 'space-1', name: 'Plans', file: 'note-1', lastAt: 2000, lastSeq: 1 }),
        chatRow(OTHER, { space: 'space-2', lastAt: 1000, lastSeq: 1 }),
      ],
    }
  },
  eventsOf: () => Promise.resolve(null),
  stateOf: () => Promise.resolve(null),
  membersOf: () => Promise.resolve([]),
}))
const { chats } = await import('./store.svelte')
const { chatsOn } = await import('../../gates/src/api')
beforeEach(async () => {
  disk.asked = []
  await chats.forget()
  await chats.start('account-1')
})
test('the Chat app has no files to place a chat in, and chats are always on in it', () => {
  expect(portProvided('chats.places')).toBe(false)
  expect(chatsOn()).toBe(true)
  expect(chatsOn('orden')).toBe(false)
  expect(chatsOn('notes')).toBe(false)
})
test('every chat of the account is listed by the name the server gives it, with its space and no path', () => {
  expect(chats.list.map((one) => [one.id, one.name, one.space, one.path, one.root])).toEqual([
    [CHAT, 'Plans', 'space-1', null, null],
    [OTHER, null, 'space-2', null, null],
  ])
})
test('nothing looks for pointer files, reads one or makes one', async () => {
  await chats.lookAgain()
  chats.pointersSeen('/space', ['/space/Plans.chat'])
  await chats.pointerMoved(null, '/space/Plans.chat')
  expect(await chats.chatAt('/space/Plans.chat')).toBeNull()
  expect(await chats.make('/space', 'New')).toBeNull()
  expect(await chats.noteReach(CHAT, '/space/Note.md')).toBeNull()
  expect(disk.asked).toEqual([])
  expect(chats.list.map((one) => one.id)).toEqual([CHAT, OTHER])
})
