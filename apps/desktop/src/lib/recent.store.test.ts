import { expect, test, vi } from 'vitest'

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async () => undefined,
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

test('the recent list is the notes in a space', () => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.device.remember('/downloads/Outside.md')
  workspace.device.remember('/space/One.md')

  expect(workspace.recent).toEqual(['/space/One.md'])
})
