import { afterEach, describe, expect, test, vi } from 'vitest'

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

async function on(os: string) {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = { __TAURI_OS_PLUGIN_INTERNALS__: { platform: os } }
  const { Protection } = await import('./protection.svelte')
  const protection = new Protection()
  protection.set('/space', '/space/Folder', 'password')
  protection.set('/space', '/space/Notes/Secret.md', 'password')
  return protection
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  localStorage.clear()
})

describe('on Windows, a locked name spelled with the dots or spaces Windows drops', () => {
  test.each([
    '/space/Folder./Secret.md',
    '/space/Folder /Secret.md',
    '/space/Folder.. ./Secret.md',
    '/space/folder./Secret.md',
    '/space/Notes./Secret.md',
    '/space/Notes/Secret.md.',
    '/space/Notes/Secret.md ',
    '/space./Folder/Secret.md',
  ])('is still locked: %s', async (path) => {
    const protection = await on('windows')
    expect(protection.covering(path).length).toBeGreaterThan(0)
    expect(protection.agentsMay(path)).toBe(false)
    expect(protection.locked(path)).toBe(true)
  })
})

describe('elsewhere, where a dot ends a name of its own', () => {
  test('a folder named with one is another folder', async () => {
    const protection = await on('linux')
    expect(protection.covering('/space/Folder./Secret.md')).toEqual([])
    expect(protection.covering('/space/Folder/Secret.md').length).toBe(1)
  })
})
