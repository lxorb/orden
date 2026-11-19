import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SidebarToggle } from '../../src/lib/titlebar/src/api'
import { workspace } from '../../src/lib/workspace/src/api'
import { idle } from './settle'

Element.prototype.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList
let host: HTMLElement
let shown: ReturnType<typeof mount>
beforeEach(() => {
  workspace.panel = null
  host = document.createElement('div')
  host.innerHTML =
    '<div data-region="space"><button class="row">Space</button></div><div data-region="list"><div data-panel="tree"><button tabindex="0" class="row">A.md</button></div></div>'
  document.body.append(host)
  shown = mount(SidebarToggle, { target: host })
  flushSync()
})
afterEach(async () => {
  await idle(200)
  void unmount(shown)
  host.remove()
  workspace.panel = null
})
const toggle = () => host.querySelector<HTMLButtonElement>('[data-side-toggle="left"]')
test('opened by a key, the toggle keeps the keyboard until Tab takes it in', async () => {
  toggle()?.focus()
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()
  expect(workspace.panel).toBe('tree')
  await idle(200)
  expect(document.activeElement).toBe(toggle())
  toggle()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.activeElement?.classList.contains('row')).toBe(true))
})
test('opened by a click, the keyboard stays where it was', async () => {
  toggle()?.focus()
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  flushSync()
  expect(workspace.panel).toBe('tree')
  await idle(200)
  expect(document.activeElement).toBe(toggle())
})
test('shut by a key, the keyboard stays on the toggle', async () => {
  workspace.panel = 'tree'
  flushSync()
  toggle()?.focus()
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()
  expect(workspace.panel).toBeNull()
  await idle(200)
  expect(document.activeElement).toBe(toggle())
})
