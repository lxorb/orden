import { expect, test, vi } from 'vitest'

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isMobile: true,
}))
vi.mock('../mobile/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mobile/bridge')>()),
  frameWord: () => Promise.resolve(''),
}))

const store = {
  secretRead: vi.fn(() => 'sk-kept'),
  secretWrite: vi.fn(),
  secretForget: vi.fn(),
}
vi.stubGlobal('__ORDEN_SYSTEM__', store)

const { NoWord } = await import('../mobile/bridge')
const keys = await import('./keys')

test('a key written with no word is not taken for saved', async () => {
  await expect(keys.writeSecret('openai', 'sk-new')).rejects.toBeInstanceOf(NoWord)
  await expect(keys.forgetKey('openai')).rejects.toBeInstanceOf(NoWord)
  expect(store.secretWrite).not.toHaveBeenCalled()
  expect(store.secretForget).not.toHaveBeenCalled()
})

test('a key read with no word is not taken for missing', async () => {
  await expect(keys.readSecret('openai')).rejects.toBeInstanceOf(NoWord)
  await expect(keys.hasKey('openai')).rejects.toBeInstanceOf(NoWord)
  expect(store.secretRead).not.toHaveBeenCalled()
})
