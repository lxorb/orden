import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

vi.mock('./sharing.svelte', () => ({
  canShareItem: () => false,
  canWriteAt: () => true,
  shareThisFile: () => undefined,
}))

const { menu } = await import('./menu.svelte')

function press(x = 10, y = 20): MouseEvent {
  return {
    clientX: x,
    clientY: y,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as MouseEvent
}

beforeEach(() => {
  menu.hide()
})

describe('what opens a menu', () => {
  test('an empty list is no menu at all', () => {
    menu.show(press(), [])
    expect(menu.open).toBe(false)
  })
})

describe('a menu held by a signal', () => {
  test('closes when the signal goes, but a later menu stays', () => {
    const lock = new AbortController()
    menu.show(press(), [{ label: 'Delete', run: () => undefined }], { until: lock.signal })
    expect(menu.open).toBe(true)
    lock.abort()
    expect(menu.open).toBe(false)

    const again = new AbortController()
    menu.show(press(), [{ label: 'Copy', run: () => undefined }], { until: again.signal })
    menu.show(press(), [{ label: 'Paste', run: () => undefined }])
    again.abort()
    expect(menu.open).toBe(true)
  })

  test('never opens once its signal has gone', () => {
    const lock = new AbortController()
    lock.abort()
    menu.show(press(), [{ label: 'Delete', run: () => undefined }], { until: lock.signal })
    expect(menu.open).toBe(false)
  })
})
