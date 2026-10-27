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
}))

const { chats } = await import('./store.svelte')

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
