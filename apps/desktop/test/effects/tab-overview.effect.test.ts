import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Every tab of the space as a card (issue #331), opened from the palette's row or
 *  Ctrl+Alt+Up: one card per tab of every pane, the arrows walk the grid, Enter on one
 *  goes to it, Escape and the key again put it away. In the jsdom project because the
 *  cards are mounted. */

/** Svelte plays a transition through the Web Animations API, which jsdom has not got. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.scrollIntoView = () => undefined

const { default: TabOverview } = await import('../../src/lib/TabOverview.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
const { appCommands } = await import('../../src/lib/commands')
const { overlays } = await import('../../src/lib/overlays')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')

let close: () => void

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  for (const name of ['One', 'Two', 'Three']) workspace.openBlank(name, `# ${name}`)
  // A second pane, whose tab is a card too.
  workspace.split('row')
  const made = mount(TabOverview, { target: document.body })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  tabOverview.open = false
  flushSync()
  close()
  vi.restoreAllMocks()
})

const cards = () => [...document.querySelectorAll<HTMLButtonElement>('.nib-tile')]

/** A key, pressed where the keyboard is. */
function press(key: string, held: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
  document.activeElement?.dispatchEvent(event)
  flushSync()
  return event
}

async function opened() {
  appCommands()
    .find((one) => one.id === 'tab-overview')
    ?.run()
  flushSync()
  await tick()
}

test('the palette’s row shows one card per tab, Enter on one goes to it and puts them away', async () => {
  await opened()
  expect(cards().map((one) => one.textContent.trim())).toEqual(['One', 'Two', 'Three', 'Three'])
  // The keyboard starts on the tab being read.
  expect(document.activeElement).toBe(document.querySelector('.nib-tile.is-on'))

  cards()[0]?.focus()
  press('Enter')
  expect(workspace.activeTabId).toBe(workspace.tabs[0]?.id)
  expect(tabOverview.open).toBe(false)
  expect(overlays.depth).toBe(0)
})

test('Down and Up walk a row of the grid at a time, and Right a tile', async () => {
  // Two tiles to a row: jsdom lays nothing out, so each tile says which row it is on.
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: Element) {
    return Math.floor(cards().indexOf(this as HTMLButtonElement) / 2)
  })
  await opened()
  cards()[0]?.focus()

  press('ArrowDown')
  expect(document.activeElement).toBe(cards()[2])
  press('ArrowRight')
  expect(document.activeElement).toBe(cards()[3])
  press('ArrowUp')
  expect(document.activeElement).toBe(cards()[1])
})

test('Escape puts it away and goes nowhere', async () => {
  await opened()
  const before = workspace.activeTabId

  expect(overlays.escape()).toBe(true)
  flushSync()
  expect(tabOverview.open).toBe(false)
  expect(workspace.activeTabId).toBe(before)
})

test('Ctrl+Alt+Up opens it, and pressed on a card puts it away again', async () => {
  const context = { palette: () => undefined, fullscreen: () => undefined }
  const up = { code: 'ArrowUp', ctrlKey: true, altKey: true }

  expect(shortcuts.handle(new KeyboardEvent('keydown', { key: 'ArrowUp', ...up }), context)).toBe(
    true,
  )
  flushSync()
  await tick()
  expect(cards()).toHaveLength(4)

  // On a card the chord is not the list's: it goes on to the window.
  const again = press('ArrowUp', up)
  expect(again.defaultPrevented).toBe(false)
  expect(shortcuts.handle(again, context)).toBe(true)
  flushSync()
  expect(tabOverview.open).toBe(false)
})
