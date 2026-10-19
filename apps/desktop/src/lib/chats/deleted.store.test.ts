import { beforeEach, expect, test, vi } from 'vitest'

/** A chat whose pointer was deleted is not listed (#375).
 *
 *  The Chats panel lists the account's chats by the pointers on this device, and the
 *  account went on listing a chat whose `.chat` pointer was in Recently deleted, so every
 *  device drew a row for it with no pointer and no name: Emil's nine rows of a lone `#`.
 *  The account no longer lists one (services/sync, `LISTED`); this is the device's half,
 *  between the delete and the account hearing of it: the row goes at once, and a pointer
 *  put back brings it back. A chat whose pointer has not come yet keeps its row. */

const CHAT = `c_${'1'.repeat(32)}`
const OTHER = `c_${'2'.repeat(32)}`
const POINTER = '/space/Plans.chat'

const account = vi.hoisted(() => ({ chats: [] as string[] }))
const disk = vi.hoisted(() => ({ pointers: new Map<string, string>() }))

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

const listed = () => chats.list.map((one) => [one.id, one.name])

beforeEach(async () => {
  workspace.spaces = [{ id: 'space-1', name: 'Space', root: '/space' }]
  await chats.forget()
  account.chats = [CHAT]
  disk.pointers = new Map([[POINTER, CHAT]])
  await chats.start('account-1')
})

test('a chat with its pointer is listed by the pointer’s name', () => {
  expect(listed()).toEqual([[CHAT, 'Plans']])
})

test('its pointer deleted, the chat is not listed, though the account still lists it', async () => {
  disk.pointers.delete(POINTER)
  await chats.pointerMoved(POINTER, null)
  expect(account.chats).toEqual([CHAT])
  expect(listed()).toEqual([])
})

test('put back from Recently deleted, the pointer brings its chat back', async () => {
  disk.pointers.delete(POINTER)
  await chats.pointerMoved(POINTER, null)
  disk.pointers.set(POINTER, CHAT)
  await chats.pointerMoved(null, POINTER)
  expect(listed()).toEqual([[CHAT, 'Plans']])
})

test('a chat whose pointer has not come yet keeps its row, nameless until it does', async () => {
  account.chats = [CHAT, OTHER]
  await chats.reconnected()
  await vi.waitFor(() =>
    expect(listed()).toEqual([
      [CHAT, 'Plans'],
      [OTHER, null],
    ]),
  )
})

test('its pointer deleted by the sync, which tells the file operations nothing, it goes too', async () => {
  disk.pointers.delete(POINTER)
  chats.pointersSeen('/space', [])
  await vi.waitFor(() => expect(listed()).toEqual([]))
  // And brought back by the sync, it comes back.
  disk.pointers.set(POINTER, CHAT)
  chats.pointersSeen('/space', [POINTER])
  await vi.waitFor(() => expect(listed()).toEqual([[CHAT, 'Plans']]))
})
