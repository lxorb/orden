/** The sidebar opened from its toggle by a key, and where the keyboard goes.
 *
 *  Found in the #419 bug hunt (#523): the sidebar comes before the bar in the page, so
 *  Tab from the toggle that had just opened it went on into the tabs and the note, and
 *  the panel was behind it. A key that opens it now takes the keyboard into it; a click
 *  leaves the keyboard where it was.
 *
 *  In the jsdom project because the toggle is mounted and pressed. jsdom lays nothing
 *  out, so every box says it has one, and the panel is a stand-in for the real one. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import SidebarToggle from '../../src/lib/SidebarToggle.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

Element.prototype.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList

let host: HTMLElement
let shown: ReturnType<typeof mount>

beforeEach(() => {
  workspace.panel = null
  host = document.createElement('div')
  host.innerHTML =
    '<div data-region="list"><div data-panel="tree"><button tabindex="0" class="row">A.md</button></div></div>'
  document.body.append(host)
  shown = mount(SidebarToggle, { target: host })
  flushSync()
})

/** A few frames, which is as long as the keyboard is kept at a side being opened. */
async function frames(count = 10) {
  for (let left = count; left > 0; left--) await new Promise((done) => requestAnimationFrame(done))
}

afterEach(async () => {
  await frames()
  void unmount(shown)
  host.remove()
  workspace.panel = null
})

const toggle = () => host.querySelector<HTMLButtonElement>('[data-side-toggle="left"]')

test('opened by a key, the sidebar has the keyboard', async () => {
  toggle()?.focus()
  // What Enter or Space on a button fires: a click with no clicks counted.
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()

  expect(workspace.panel).toBe('tree')
  await vi.waitFor(() => expect(document.activeElement?.classList.contains('row')).toBe(true))
})

test('opened by a click, the keyboard stays where it was', async () => {
  toggle()?.focus()
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  flushSync()

  expect(workspace.panel).toBe('tree')
  await frames()
  expect(document.activeElement).toBe(toggle())
})

test('shut by a key, the keyboard stays on the toggle', async () => {
  workspace.panel = 'tree'
  flushSync()
  toggle()?.focus()
  toggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  flushSync()

  expect(workspace.panel).toBeNull()
  await frames()
  expect(document.activeElement).toBe(toggle())
})
