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

describe('helping improve Orden, across windows', () => {
  test('turned off in another window stops this one too', async () => {
    localStorage.setItem('orden:usage-help', 'true')
    const { usageChoice } = await import('./choice.svelte')
    let changed = 0
    usageChoice.changes.add(() => changed++)
    expect(usageChoice.helping).toBe(true)

    localStorage.setItem('orden:usage-help', 'false')
    told('orden:usage-help')

    expect(usageChoice.helping).toBe(false)
    expect(changed).toBe(1)
  })
})
