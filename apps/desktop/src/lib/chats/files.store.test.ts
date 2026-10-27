import { expect, test, vi } from 'vitest'

/** The store keeps a file's address only once it has one (B545). `fileOf` answers null for
 *  a dropped connection or a 5xx, and the store kept that answer for the whole session, so
 *  "Save as note" and every surface left the file out until the app restarted. */

const server = vi.hoisted(() => ({ answers: [] as (Blob | null)[], asked: 0 }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))

vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  fileOf: () => {
    server.asked++
    return Promise.resolve(server.answers.shift() ?? null)
  },
  putBlob: () => Promise.resolve(true),
}))

const { chats } = await import('./store.svelte')
const { account } = await import('../account.svelte')

test('a failed fetch is not kept, a landed one is', async () => {
  server.answers = [null, new Blob(['x'])]
  expect(await chats.fileUrl('c1', 'h1')).toBeNull()
  const url = await chats.fileUrl('c1', 'h1')
  expect(url).toMatch(/^blob:/)
  expect(await chats.fileUrl('c1', 'h1')).toBe(url)
  expect(server.asked).toBe(2)
})

test('signing out forgets the addresses', async () => {
  server.asked = 0
  server.answers = [new Blob(['a']), new Blob(['b'])]
  const first = await chats.fileUrl('c2', 'h1')
  await chats.forget()
  const second = await chats.fileUrl('c2', 'h1')
  expect(second).not.toBe(first)
  expect(server.asked).toBe(2)
})

test('a file the server does not know yet is asked again: a post names it before it lands', async () => {
  server.asked = 0
  // the route answers 404 until the post that names the file is folded
  server.answers = [null, new Blob(['x'])]
  expect(await chats.fileUrl('c3', 'h1')).toBeNull()
  expect(await chats.fileUrl('c3', 'h1')).toMatch(/^blob:/)
  expect(server.asked).toBe(2)
})

test('a file this device put up is drawn from its own bytes, without a round trip', async () => {
  server.asked = 0
  const hash = await chats.upload(new TextEncoder().encode('my picture'))
  expect(hash).toBeTruthy()
  const url = await chats.fileUrl('c5', hash ?? '')
  expect(url).toMatch(/^blob:/)
  expect(server.asked).toBe(0)
})

test("a reader who just signed in is never handed the last one's address", async () => {
  server.answers = [new Blob(['guest']), new Blob(['user'])]
  account.guest = { id: 'g1' } as typeof account.guest
  const before = await chats.fileUrl('c6', 'h1')
  // the guest becomes a user in one tick; the store hears of it a moment later
  account.guest = null
  account.user = { id: 'u1' } as typeof account.user
  const after = await chats.fileUrl('c6', 'h1')
  expect(after).not.toBe(before)
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  await chats.start('user:u1')
  await Promise.resolve()
  expect(revoke).toHaveBeenCalledWith(before)
  expect(revoke).not.toHaveBeenCalledWith(after)
  revoke.mockRestore()
  account.user = null
})

test('signing out lets go of the files it drew', async () => {
  server.answers = [new Blob(['a'])]
  const url = await chats.fileUrl('c4', 'h1')
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  await chats.forget()
  expect(revoke).toHaveBeenCalledWith(url)
})
