/** The divider between two panes, moved from the keyboard.
 *
 *  Found in the #419 bug hunt (#523): it had no role, no tab stop and no key, so only a
 *  hand could move it, where the sidebar's edge beside it is a separator the arrows move.
 *  What is asked is what a reader gets: a separator, how far along it is, and the keys.
 *
 *  In the jsdom project because the split is mounted. The panes in it are not what this
 *  is about, and jsdom lays nothing out, so the split is told its size. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/Pane.svelte', () => ({ default: () => undefined }))

HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)

const { workspace } = await import('../../src/lib/workspace.svelte')
const PaneTree = (await import('../../src/lib/PaneTree.svelte')).default

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  workspace.panes.collapse()
  document.body.replaceChildren()
})

test('the divider is a separator the arrows, Home, End and Enter move', () => {
  workspace.panes.split('row')
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(PaneTree, { target, props: { frame: workspace.panes.frame } })
  flushSync()

  const divider = target.querySelector<HTMLElement>('[role="separator"]')
  expect(divider?.tabIndex).toBe(0)
  expect(divider?.getAttribute('aria-orientation')).toBe('vertical')
  expect(divider?.getAttribute('aria-valuenow')).toBe('50')

  const press = (key: string) => {
    divider?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
    return divider?.getAttribute('aria-valuenow')
  }

  expect(press('ArrowRight')).toBe('55')
  expect(press('ArrowLeft')).toBe('50')
  // As far as a pane may be pushed: 220 pixels of the 1,000 left on the other side.
  expect(press('End')).toBe('78')
  expect(press('Home')).toBe('22')
  expect(press('Enter')).toBe('50')
})
