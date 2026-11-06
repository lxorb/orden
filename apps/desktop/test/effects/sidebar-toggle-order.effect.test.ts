import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const into = vi.hoisted(() => ({ side: vi.fn<(side: string) => HTMLElement | null>() }))

vi.mock('../../src/lib/focus', () => ({ intoSide: into.side }))

const SidebarToggle = (await import('../../src/lib/SidebarToggle.svelte')).default
const { workspace } = await import('../../src/lib/workspace.svelte')

let shown: ReturnType<typeof mount>
let inside: HTMLElement
let toggle: HTMLElement

const tab = (at: HTMLElement, shiftKey = false) => {
  const press = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  at.dispatchEvent(press)
  return press.defaultPrevented
}

beforeEach(() => {
  workspace.closePanel()
  inside = document.body.appendChild(document.createElement('button'))
  into.side.mockReset()
  into.side.mockImplementation(() => {
    inside.focus()
    return inside
  })
  shown = mount(SidebarToggle, { target: document.body })
  flushSync()
  toggle = document.querySelector<HTMLElement>('[data-side-toggle]')!
  toggle.focus()
})

afterEach(() => {
  void unmount(shown)
  document.body.replaceChildren()
  workspace.closePanel()
})

test('Tab after opening with a key goes into the side, and Shift+Tab back', () => {
  toggle.click()
  flushSync()
  expect(workspace.openOn('left')).toBeTruthy()

  expect(tab(toggle)).toBe(true)
  expect(into.side).toHaveBeenCalledWith('left')
  expect(document.activeElement).toBe(inside)

  expect(tab(inside, true)).toBe(true)
  expect(document.activeElement).toBe(toggle)

  expect(tab(toggle)).toBe(false)
})

test('Tab from a toggle the keyboard has come back round to goes on along the bar', () => {
  toggle.click()
  flushSync()
  tab(toggle)
  inside.blur()
  toggle.focus()

  expect(tab(toggle)).toBe(false)
})

test('a press with the pointer, which has no Tab coming, changes nothing', () => {
  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  flushSync()

  expect(tab(toggle)).toBe(false)
})

test('closing it does not send Tab anywhere', () => {
  toggle.click()
  flushSync()
  toggle.click()
  flushSync()

  expect(tab(toggle)).toBe(false)
})
