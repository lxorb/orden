import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})
const { menu, trim } = await import('./menu.svelte')
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
describe('which menu is showing (#2481)', () => {
  const row = (label: string) => ({ label, run: () => undefined })
  test('a submenu is still the menu it came from, a new menu is another, and a closed one is none', () => {
    const first = menu.show(press(), [row('Copy')])
    expect(first).toBeGreaterThan(0)
    expect(menu.show(press(), [row('Left to right')], { sub: true })).toBe(first)
    expect(menu.which).toBe(first)
    const second = menu.show(press(), [row('Paste')])
    expect(second).not.toBe(first)
    menu.hide()
    expect(menu.which).toBe(0)
    expect(menu.show(press(), [row('One')], { sub: true })).not.toBe(second)
    expect(menu.show(press(), [])).toBe(0)
  })
  test('opened by keys it lights its first row that can be chosen, opened by a pointer none', () => {
    const rows = [{ ...row('Cut'), disabled: true }, row('Copy'), row('Paste')]
    menu.show(press(), rows, { keepFocus: true, keys: true })
    expect([menu.keys, menu.lit]).toEqual([true, 1])
    menu.show(press(), rows, { keepFocus: true, keys: false })
    expect([menu.keys, menu.lit]).toEqual([false, -1])
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
describe('the lines between the rows of a menu (#2374)', () => {
  const row = (label: string) => ({ label, run: () => undefined })
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(row)
  const drawn = (items: Parameters<typeof trim>[0]) =>
    trim(items).map((one) => (one === null ? '|' : (one as { label: string }).label))
  test('part only two groups of two rows or more', () => {
    expect(drawn([a, b, null, c, d])).toEqual(['A', 'B', '|', 'C', 'D'])
  })
  test('never set off a single row, so a menu of single rows has no lines at all', () => {
    expect(drawn([a, null, b, null, c, null, d])).toEqual(['A', 'B', 'C', 'D'])
    expect(drawn([a, b, null, c])).toEqual(['A', 'B', 'C'])
    expect(drawn([a, null, b, c])).toEqual(['A', 'B', 'C'])
    expect(drawn([a, b, null, c, null, d, row('E')])).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
  test('and never stand first, last or twice', () => {
    expect(drawn([null, a, b, null, null, c, d, null])).toEqual(['A', 'B', '|', 'C', 'D'])
    expect(drawn([null, null])).toEqual([])
  })
})
