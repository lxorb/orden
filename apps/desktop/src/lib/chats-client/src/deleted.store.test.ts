import { beforeEach, expect, test, vi } from 'vitest'

const CHAT = `c_${'1'.repeat(32)}`
const OTHER = `c_${'2'.repeat(32)}`
const POINTER = '/space/Plans.chat'
const account = vi.hoisted(() => ({ chats: [] as string[], unheard: 0 }))
const disk = vi.hoisted(() => ({ pointers: new Map<string, string>(), fails: 0 }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  listChats: async () => {
    if (account.unheard > 0) {
      account.unheard -= 1
      return null
    }
    const { chatRow } = await import('./test-account')
    return {
      chats: account.chats.map((id) => chatRow(id, { space: 'space-1', role: 'owner', members: 1 })),
    }
  },
  eventsOf: () => Promise.resolve(null),
  stateOf: () => Promise.resolve(null),
}))
vi.mock('./pointers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pointers')>()),
  findPointers: () => {
    if (disk.fails > 0) {
      disk.fails -= 1
      return Promise.reject(new Error('the disk did not answer'))
    }
    return Promise.resolve(new Map([...disk.pointers].map(([path, chat]) => [chat, { root: '/space', path }])))
  },
  readPointer: (path: string) => Promise.resolve(disk.pointers.get(path) ?? null),
}))
const { chats } = await import('./store.svelte')
const { workspace } = await import('../../workspace/src/api')
const listed = () => chats.list.map((one) => [one.id, one.name])
beforeEach(async () => {
  workspace.spaces = [{ id: 'space-1', name: 'Space', root: '/space' }]
  await chats.forget()
  account.chats = [CHAT]
  account.unheard = 0
  disk.pointers = new Map([[POINTER, CHAT]])
  disk.fails = 0
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
test('a chat whose pointer has not come yet is not listed, a nameless row nobody can open, until it comes (#2321)', async () => {
  account.chats = [CHAT, OTHER]
  await chats.reconnected()
  await vi.waitFor(() => expect(chats.entry(OTHER)).toBeNull())
  expect(listed()).toEqual([[CHAT, 'Plans']])
  disk.pointers.set('/space/Launch.chat', OTHER)
  chats.pointersSeen('/space', [POINTER, '/space/Launch.chat'])
  await vi.waitFor(() =>
    expect(listed()).toEqual([
      [CHAT, 'Plans'],
      [OTHER, 'Launch'],
    ]),
  )
})
test('a chat whose pointer was deleted elsewhere is not listed after a reload, though the account still lists it (#2321)', async () => {
  await chats.forget()
  account.chats = [CHAT, OTHER]
  await chats.start('account-1')
  expect(listed()).toEqual([[CHAT, 'Plans']])
})
test('its pointer deleted by the sync, which tells the file operations nothing, it goes too', async () => {
  disk.pointers.delete(POINTER)
  chats.pointersSeen('/space', [])
  await vi.waitFor(() => expect(listed()).toEqual([]))
  disk.pointers.set(POINTER, CHAT)
  chats.pointersSeen('/space', [POINTER])
  await vi.waitFor(() => expect(listed()).toEqual([[CHAT, 'Plans']]))
})
test('a chat whose pointer comes late is named when it comes, though a look for it failed on the way (#2269)', async () => {
  vi.useFakeTimers()
  try {
    await chats.forget()
    account.chats = [CHAT, OTHER]
    await chats.start('account-1')
    expect(listed()).toEqual([[CHAT, 'Plans']])
    disk.fails = 1
    await vi.advanceTimersByTimeAsync(3_000)
    disk.pointers.set('/space/Launch.chat', OTHER)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listed()).toEqual([
      [CHAT, 'Plans'],
      [OTHER, 'Launch'],
    ])
  } finally {
    vi.useRealTimers()
  }
})
test('a chat ended elsewhere while this device was offline leaves the list on reconnecting, though its pointer is still here (#2321)', async () => {
  disk.pointers.set('/space/Launch.chat', OTHER)
  account.chats = [CHAT, OTHER]
  await chats.reconnected()
  chats.pointersSeen('/space', [POINTER, '/space/Launch.chat'])
  await vi.waitFor(() =>
    expect(listed()).toEqual([
      [CHAT, 'Plans'],
      [OTHER, 'Launch'],
    ]),
  )
  account.chats = [CHAT]
  await chats.reconnected()
  await vi.waitFor(() => expect(listed()).toEqual([[CHAT, 'Plans']]))
  expect(disk.pointers.get('/space/Launch.chat')).toBe(OTHER)
})
test('a reconnect whose first listing does not get through asks again until it does, so an ended chat still leaves (#2321)', async () => {
  vi.useFakeTimers()
  try {
    account.chats = []
    account.unheard = 2
    const coming = chats.reconnected()
    await vi.advanceTimersByTimeAsync(5_000)
    await coming
    expect(listed()).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
