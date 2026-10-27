import { beforeEach, expect, test, vi } from 'vitest'

/** A copy of a chat's pointer is a second pointer, never a move (B542).
 *
 *  A copy says only that a file came (`fileCame`, workspace/copying.ts), which the chats
 *  hear as a pointer from nowhere. Taken as the chat's new place, a copy pasted into
 *  another space moved the chat there on the account, nobody asked: the first space's
 *  people lost it and the second's could read its whole history. Access is the chat's
 *  space, never the file (docs/chats.md 4.2), so a copy stays a pointer that reaches
 *  the chat for those who already could, and the chat stays where it lives.
 *
 *  Where it is listed is the account's to say, not the order of the spaces or the
 *  names: a scan, a deleted original or a restored one never hands its place to a
 *  copy, and only its own pointer carried into another space moves it, through the
 *  rule chat-leaving.ts asks the account under. The disk here is a map of pointers,
 *  scanned in the spaces' order and by name as the tree sorts them. */

const CHAT = `c_${'1'.repeat(32)}`
const POINTER = '/space/Plans.chat'

const account = vi.hoisted(() => ({ chats: [] as string[] }))
const moves = vi.hoisted(() => [] as string[])
const disk = vi.hoisted(() => ({ pointers: new Map<string, string>() }))

vi.mock('../sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) =>
      ({ '/space': 'space-1', '/other': 'space-2', '/third': 'space-3' })[root] ?? null,
    nudge: () => undefined,
    tracked: () => null,
    roleKept: () => null,
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

vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  roleOf: () => 'owner',
}))

vi.mock('./pointers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pointers')>()),
  // As the real one walks them: space by space in the order they are listed, and by
  // name inside each, `Plans copy.chat` before `Plans.chat` as the tree sorts them.
  findPointers: async (
    rank: (chat: string, place: { root: string; path: string }) => number = () => 0,
  ) => {
    const found = new Map<string, { root: string; path: string }>()
    for (const space of workspace.spaces) {
      for (const [path, chat] of [...disk.pointers].sort()) {
        if (!path.startsWith(`${space.root}/`)) continue
        const place = { root: space.root, path }
        const held = found.get(chat)
        if (!held || rank(chat, place) > rank(chat, held)) found.set(chat, place)
      }
    }
    return found
  },
  readPointer: (path: string) => Promise.resolve(disk.pointers.get(path) ?? null),
}))

const { chats } = await import('./store.svelte')
const { workspace } = await import('../workspace.svelte')
const { chatsCarried } = await import('../workspace/chat-leaving')

beforeEach(async () => {
  workspace.spaces = [
    { id: 'space-1', name: 'Space', root: '/space' },
    { id: 'space-2', name: 'Other', root: '/other' },
    { id: 'space-3', name: 'Third', root: '/third' },
  ]
  await chats.forget()
  account.chats = [CHAT]
  disk.pointers = new Map([[POINTER, CHAT]])
  moves.length = 0
  await chats.start('account-1')
})

const paths = () => chats.list.map((one) => one.path)
const rescan = () => (chats as unknown as { lookForPointers(): Promise<void> }).lookForPointers()
const OTHER_FIRST = [
  { id: 'space-2', name: 'Other', root: '/other' },
  { id: 'space-1', name: 'Space', root: '/space' },
  { id: 'space-3', name: 'Third', root: '/third' },
]

/** A file operation as the chats hear it, with the disk changed first. */
async function came(path: string) {
  disk.pointers.set(path, CHAT)
  await chats.pointerMoved(null, path)
}
async function went(path: string) {
  disk.pointers.delete(path)
  await chats.pointerMoved(path, null)
}
async function moved(from: string, to: string) {
  disk.pointers.delete(from)
  disk.pointers.set(to, CHAT)
  await chats.pointerMoved(from, to)
}

test('a pointer copied into another space leaves its chat where it lives', async () => {
  await came('/other/Plans.chat')

  expect(moves).toEqual([])
  expect(paths()).toEqual([POINTER])
})

test('a pointer duplicated beside itself leaves the chat listed at its own, scanned again too', async () => {
  await came('/space/Plans copy.chat')
  expect(paths()).toEqual([POINTER])

  await rescan()
  expect(paths()).toEqual([POINTER])
})

test('a copy undone leaves the chat listed', async () => {
  await came('/other/Plans.chat')
  await went('/other/Plans.chat')

  expect(paths()).toEqual([POINTER])
})

test('a copy in a space listed first, scanned again and renamed there, moves nothing', async () => {
  workspace.spaces = OTHER_FIRST
  await came('/other/Plans.chat')
  await rescan()
  expect(paths()).toEqual([POINTER])

  await moved('/other/Plans.chat', '/other/Renamed.chat')
  expect(moves).toEqual([])
  expect(paths()).toEqual([POINTER])
})

test('the original deleted while a copy is in another space, the copy renamed moves nothing', async () => {
  await came('/other/Plans.chat')
  await went(POINTER)
  await moved('/other/Plans.chat', '/other/Renamed.chat')
  await moved('/other/Renamed.chat', '/other/Again.chat')

  expect(moves).toEqual([])
})

test('the original deleted while a copy is in another space, scanned again, the copy renamed moves nothing', async () => {
  await came('/other/Plans.chat')
  await went(POINTER)
  await rescan()
  await moved('/other/Plans.chat', '/other/Renamed.chat')

  expect(moves).toEqual([])
})

test('the original put back after a scan placed the chat at a copy is its place again', async () => {
  await came('/other/Plans.chat')
  await went(POINTER)
  await rescan()
  await came(POINTER)

  expect(chats.placedAt(CHAT)).toBe(POINTER)
  expect(paths()).toEqual([POINTER])
})

test("the chat's own pointer moved is listed where it went, and the file op moves nothing", async () => {
  await moved(POINTER, '/other/Plans.chat')

  expect(moves).toEqual([])
  expect(paths()).toEqual(['/other/Plans.chat'])
})

test("the chat's own pointer carried into another space moves the chat there", async () => {
  await chatsCarried(POINTER, '/other')

  expect(moves).toEqual([`${CHAT} space-2`])
})

test('a duplicate carried into another space moves the file, never the chat', async () => {
  await came('/space/Plans copy.chat')
  await rescan()
  await chatsCarried('/space/Plans copy.chat', '/other')

  expect(moves).toEqual([])
})

test('a copy in another space carried on, its original deleted, never moves the chat', async () => {
  await came('/other/Plans.chat')
  await went(POINTER)
  await rescan()
  await chatsCarried('/other/Plans.chat', '/third')

  expect(moves).toEqual([])
})
