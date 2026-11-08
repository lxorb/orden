import { expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => held.set(key, value),
  removeItem: (key: string) => held.delete(key),
  clear: () => held.clear(),
})

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { signOut: () => Promise.resolve() },
}))

const { account } = await import('../../account.svelte')
const { saved } = await import('./saved.svelte')

test('one account’s saved messages are gone once it signs out', async () => {
  account.token = 'token'
  saved.toggle('c_1', { id: 'm1', author: 'user:ana', body: 'Keep this\nand more', at: 1 } as never)
  expect(localStorage.getItem('orden:chats-saved')).toContain('Keep this')

  await account.signOut()

  expect(saved.list).toEqual([])
  expect(localStorage.getItem('orden:chats-saved')).toBeNull()
})
