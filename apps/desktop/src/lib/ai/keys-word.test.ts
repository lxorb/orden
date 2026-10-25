import { expect, test, vi } from 'vitest'

/** A key written, forgotten or read on the phone before the activity has said its
 *  word (B456). The activity drops a call with no word and says nothing, so a key
 *  would look saved that never was, or missing when it is there. Each says it could
 *  not instead, and the store is not asked with no word. */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
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
vi.stubGlobal('__NIB_SYSTEM__', store)

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
