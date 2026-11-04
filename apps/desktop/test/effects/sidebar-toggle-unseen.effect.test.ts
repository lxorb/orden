/** The file list's button where a swipe from the edge pulls the list out (#1066): said,
 *  not shown. Out of the bar to an eye, there to a screen reader, and seen again while
 *  the keyboard is on it - and pressed, it still opens the list. In the jsdom project
 *  because it mounts the component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'

const SidebarToggle = (await import('../../src/lib/SidebarToggle.svelte')).default
const { workspace } = await import('../../src/lib/workspace.svelte')

let shown: ReturnType<typeof mount>
let toggle: HTMLButtonElement

beforeEach(() => {
  workspace.closePanel()
  shown = mount(SidebarToggle, { target: document.body, props: { unseen: true } })
  flushSync()
  toggle = document.querySelector<HTMLButtonElement>('[data-side-toggle]')!
})

afterEach(() => {
  void unmount(shown)
  document.body.replaceChildren()
  workspace.closePanel()
})

test('is said and not shown, named for a screen reader, and still opens the list', () => {
  expect(toggle.classList.contains('nib-said')).toBe(true)
  expect(toggle.getAttribute('aria-label')).toBe('Show left sidebar')
  expect(toggle.tabIndex).toBe(0)
  toggle.click()
  flushSync()
  expect(workspace.openOn('left')).toBeTruthy()
})

test('is seen while the keyboard is on it, and said again once it leaves', () => {
  toggle.matches = (selector: string) => selector === ':focus-visible'
  toggle.focus()
  flushSync()
  expect(toggle.classList.contains('nib-said')).toBe(false)
  toggle.blur()
  flushSync()
  expect(toggle.classList.contains('nib-said')).toBe(true)
})
