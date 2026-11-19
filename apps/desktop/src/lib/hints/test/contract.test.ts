import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {},
    toggleAttribute: () => false,
  },
})
const { hinting } = await import('../src/api')
beforeEach(() => localStorage.clear())
describe('the hints', () => {
  test('show one wanted hint once the session settles', async () => {
    const { hints } = await hinting()
    hints.restore()
    hints.want('drawer', true)
    expect(hints.current).toBeNull()
    hints.settle()
    expect(hints.current).toBe('drawer')
  })
  test('keep a dismissed hint dismissed in the next session', async () => {
    const { hints } = await hinting()
    hints.restore()
    hints.dismiss('graph')
    hints.restore()
    expect(hints.seen).toContain('graph')
    expect(hints.open('graph')).toBe(false)
  })
})
