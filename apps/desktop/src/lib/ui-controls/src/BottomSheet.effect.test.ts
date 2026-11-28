import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const BottomSheet = (await import('./BottomSheet.svelte')).default
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})
const words = createRawSnippet(() => ({ render: () => '<p>Words</p>' }))
function sheet(): { closed: () => number; node: HTMLElement } {
  let closed = 0
  shown = mount(BottomSheet, {
    target: document.body,
    props: { open: true, label: 'Block', onclose: () => (closed += 1), children: words },
  })
  flushSync()
  const node = document.querySelector<HTMLElement>('[role=dialog]')
  if (!node) throw new Error('no sheet')
  return { closed: () => closed, node }
}
function touch(node: HTMLElement, kind: string, y: number, at: number) {
  const point = { clientX: 100, clientY: y }
  const event = new Event(kind, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: at })
  Object.assign(event, { touches: kind === 'touchend' ? [] : [point], changedTouches: [point] })
  node.dispatchEvent(event)
}
test('a bottom sheet is a named dialog that a web tab is cut for, with a shade under it that closes it', () => {
  const { closed, node } = sheet()
  expect([node.getAttribute('aria-label'), node.getAttribute('aria-modal')]).toEqual(['Block', 'true'])
  expect(node.hasAttribute('data-covers')).toBe(true)
  expect(node.textContent).toContain('Words')
  document.querySelector<HTMLElement>('.shade')?.click()
  expect(closed()).toBe(1)
})
test('Escape closes it, and no other key does', () => {
  const { closed, node } = sheet()
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  expect(closed()).toBe(0)
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(closed()).toBe(1)
})
test('dragging it down from its grip closes it', async () => {
  const { closed, node } = sheet()
  Object.defineProperty(node, 'offsetHeight', { value: 400 })
  node.getBoundingClientRect = () => new DOMRect(0, 400, 390, 400)
  touch(node, 'touchstart', 410, 0)
  touch(node, 'touchmove', 560, 40)
  touch(node, 'touchend', 560, 50)
  await vi.waitFor(() => expect(closed()).toBe(1))
})
test('shut, it draws nothing', () => {
  shown = mount(BottomSheet, {
    target: document.body,
    props: { open: false, label: 'Block', onclose: () => undefined, children: words },
  })
  flushSync()
  expect(document.querySelector('[role=dialog], .shade')).toBeNull()
})
