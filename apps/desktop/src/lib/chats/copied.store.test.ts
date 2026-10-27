import { beforeEach, expect, test, vi } from 'vitest'

/** A copy of a chat's pointer is a second pointer, never a move (B542).
 *
 *  A copy says only that a file came (`fileCame`, workspace/copying.ts), which the chats
 *  hear as a pointer from nowhere. Taken as the chat's new place, a copy pasted into
 *  another space moved the chat there on the account, nobody asked: the first space's
 *  people lost it and the second's could read its whole history. Access is the chat's
 *  space, never the file (docs/chats.md 4.2), so a copy stays a pointer that reaches
 *  the chat for those who already could, and the chat stays where it lives, listed at
 *  the pointer it had. Only its own pointer moved re-homes it. */

const CHAT = `c_${'1'.repeat(32)}`
const POINTER = '/space/Plans.chat'

const account = vi.hoisted(() => ({ chats: [] as string[] }))
const moves = vi.hoisted(() => [] as string[])
const disk = vi.hoisted(() => ({ pointers: new Map<string, string>() }))

vi.mock('../sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) =>
      root === '/space' ? 'space-1' : root === '/other' ? 'space-2' : null,
    nudge: () => undefined,
    tracked: () => null,
  },
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))

vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  listChats: () =>
    Promise.resolve({
      chats: account.chats.map((id) => ({
        id,
        space: 'space-1',
        role: 'owner',
        members: 1,
        lastSeq: 0,
        lastAt: null,
        lastBy: null,
        readSeq: 0,
        mentions: 0,
        notify: null,
        mutedUntil: null,
        meta: { topic: '', posting: 'writers', slowmode: 0 },
      })),
    }),
  eventsOf: () => Promise.resolve(null),
  moveChat: (chat: string, space: string) => {
    moves.push(`${chat} ${space}`)
    return Promise.resolve(true)
  },
  stateOf: () => Promise.resolve(null),
}))

vi.mock('./pointers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pointers')>()),
  findPointers: () =>
    Promise.resolve(
      new Map([...disk.pointers].map(([path, chat]) => [chat, { root: '/space', path }])),
    ),
  readPointer: (path: string) => Promise.resolve(disk.pointers.get(path) ?? null),
}))

const { chats } = await import('./store.svelte')
const { workspace } = await import('../workspace.svelte')

beforeEach(async () => {
  workspace.spaces = [
    { id: 'space-1', name: 'Space', root: '/space' },
    { id: 'space-2', name: 'Other', root: '/other' },
  ]
  await chats.forget()
  account.chats = [CHAT]
  disk.pointers = new Map([[POINTER, CHAT]])
  moves.length = 0
  await chats.start('account-1')
})

const paths = () => chats.list.map((one) => one.path)

test('a pointer copied into another space leaves its chat where it lives', async () => {
  disk.pointers.set('/other/Plans.chat', CHAT)
  await chats.pointerMoved(null, '/other/Plans.chat')

  expect(moves).toEqual([])
  expect(paths()).toEqual([POINTER])
})

test('a pointer duplicated beside itself leaves the chat listed at its own', async () => {
  disk.pointers.set('/space/Plans copy.chat', CHAT)
  await chats.pointerMoved(null, '/space/Plans copy.chat')

  expect(paths()).toEqual([POINTER])
})

test('a copy undone leaves the chat listed', async () => {
  disk.pointers.set('/other/Plans.chat', CHAT)
  await chats.pointerMoved(null, '/other/Plans.chat')
  disk.pointers.delete('/other/Plans.chat')
  await chats.pointerMoved('/other/Plans.chat', null)

  expect(paths()).toEqual([POINTER])
})

test('a copy moved into another space leaves its chat where it lives', async () => {
  disk.pointers.set('/space/Plans copy.chat', CHAT)
  await chats.pointerMoved(null, '/space/Plans copy.chat')
  disk.pointers.delete('/space/Plans copy.chat')
  disk.pointers.set('/other/Plans copy.chat', CHAT)
  await chats.pointerMoved('/space/Plans copy.chat', '/other/Plans copy.chat')

  expect(moves).toEqual([])
  expect(paths()).toEqual([POINTER])
})

test("the chat's own pointer moved into another space moves the chat there", async () => {
  disk.pointers.delete(POINTER)
  disk.pointers.set('/other/Plans.chat', CHAT)
  await chats.pointerMoved(POINTER, '/other/Plans.chat')

  expect(moves).toEqual([`${CHAT} space-2`])
  expect(paths()).toEqual(['/other/Plans.chat'])
})

test('a pointer put back where nothing else points at its chat lists it again', async () => {
  disk.pointers.delete(POINTER)
  await chats.pointerMoved(POINTER, null)
  disk.pointers.set(POINTER, CHAT)
  await chats.pointerMoved(null, POINTER)

  expect(moves).toEqual([])
  expect(paths()).toEqual([POINTER])
})
