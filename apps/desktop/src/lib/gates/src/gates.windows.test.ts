import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (at) => [...store.keys()][at] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

type Heard = (event: { key: string | null }) => void
const heard: Heard[] = []

beforeEach(() => {
  heard.length = 0
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Heard) => {
      if (type === 'storage') heard.push(listener)
    },
  })
})

const told = (key: string) => {
  for (const listener of heard) listener({ key })
}

describe('note types and experimental switches, across windows', () => {
  test('changed in another window are the ones this window builds on', async () => {
    const { hiddenKinds, KINDS_KEY } = await import('./gates.svelte')
    hiddenKinds.restore()
    localStorage.setItem(KINDS_KEY, JSON.stringify(['experimental', 'chat']))
    told(KINDS_KEY)
    expect(hiddenKinds.hidden).toEqual(['experimental', 'chat'])
  })
})
