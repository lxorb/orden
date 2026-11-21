import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const panel = vi.hoisted(() => ({
  head: null as { id: string } | null,
  heads: [] as unknown[],
  unread: new Set<string>(),
  states: new Map<string, string>(),
  listQuery: '',
  listing: false,
  openThread: vi.fn(),
  newThread: vi.fn(),
  focus: vi.fn(),
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)
const Threads = (await import('./Threads.svelte')).default
const listed = (id: string, updated: number) => ({ id, title: id, updated, state: 'done', provider: 'p', model: 'm' })
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  panel.openThread.mockClear()
})
function rail() {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Threads, { target, props: { rail: true } })
  flushSync()
  close = () => void unmount(shown).then(() => target.remove())
  const lit = () => [...target.querySelectorAll('.row.lit')].map((one) => one.textContent.trim())
  const field = target.querySelector('input')
  if (!field) throw new Error('no field')
  return { target, lit, field }
}
const key = (field: HTMLInputElement, name: string) => {
  field.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  flushSync()
}
describe('the chats beside a chat (#2413)', () => {
  test('light no chat of their own: only the open one is marked, and a new chat leaves none marked', () => {
    panel.heads = [listed('Gey', 3), listed('Garden', 2), listed('Herons', 1)]
    panel.head = { id: 'fresh' }
    const { target, lit } = rail()
    expect(lit()).toEqual([])
    expect(target.querySelectorAll('.row.open')).toHaveLength(0)
  })
  test('light the row the pointer is over, and none once it leaves the list', () => {
    panel.heads = [listed('Gey', 3), listed('Garden', 2)]
    const { target, lit } = rail()
    target.querySelectorAll('.row')[1]?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    flushSync()
    expect(lit()).toHaveLength(1)
    target.querySelector('.list')?.dispatchEvent(new PointerEvent('pointerleave'))
    flushSync()
    expect(lit()).toEqual([])
  })
  test('are walked from the first by the arrow keys, and Enter with none lit opens the first', () => {
    panel.heads = [listed('Gey', 3), listed('Garden', 2)]
    const { lit, field } = rail()
    key(field, 'Enter')
    expect(panel.openThread).toHaveBeenCalledWith('Gey')
    key(field, 'ArrowDown')
    expect(lit()).toHaveLength(1)
    expect(lit()[0]).toContain('Gey')
  })
})
