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

const listeners: ((event: { key: string }) => void)[][] = []

async function aWindow() {
  const mine: ((event: { key: string }) => void)[] = []
  listeners.push(mine)
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: { key: string }) => void) => {
      if (type === 'storage') mine.push(listener)
    },
  })
  vi.resetModules()
  const { modes } = await import('./modes.svelte')
  modes.restore()
  return modes
}

function storageMoved(except: number) {
  listeners.forEach((one, at) => {
    if (at !== except) for (const listener of one) listener({ key: 'nib:modes' })
  })
}

beforeEach(() => {
  listeners.length = 0
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', {
    documentElement: {
      style: { setProperty: () => undefined },
      dataset: {},
      toggleAttribute: () => true,
    },
  })
})

const stored = () =>
  JSON.parse(localStorage.getItem('nib:modes') ?? '{}') as Record<string, unknown>

describe('settings across two windows', () => {
  test('a setting made in one is heard in the other, and its next write keeps it', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.setLineSpacing(2.1)
    storageMoved(0)
    expect(b.lineHeight).toBe(2.1)
    b.toggleTypewriter()
    expect(stored().lineHeight).toBe(2.1)
    expect(stored().typewriter).toBe(true)
  })

  test('two writes before either has heard the other keep both', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.setLineSpacing(2.1)
    b.toggleTypewriter()
    expect(stored().lineHeight).toBe(2.1)
    expect(stored().typewriter).toBe(true)
  })

  test('a field one window does not hold is not dropped by its write', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.setLineSpacing(2.1)
    const held = stored()
    localStorage.setItem('nib:modes', JSON.stringify({ ...held, developer: true }))
    b.toggleTypewriter()
    expect(stored().developer).toBe(true)
  })
})
