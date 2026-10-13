import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import SpaceSwitcher from '../../src/lib/SpaceSwitcher.svelte'
import Titlebar from '../../src/lib/Titlebar.svelte'
import { spacesMenu } from '../../src/lib/surfaces.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** The space switcher in the panel's header, and the title bar without one.
 *
 *  The header names the space and a press on it is the list of spaces. The title bar
 *  wore the space's mark too while the panel was shut, until Emil, 2026-10-13:
 *  *"remove this space switcher here"*. With the panel shut, Ctrl+Space and the
 *  palette reach every space. Where the list drops is paint, which the drive in a real
 *  browser looks at; this asks what a press does.
 *
 *  In the jsdom project because mounting a component needs a document. */

/** The list arrives and leaves with a transition, and Svelte plays one through the
 *  Web Animations API, which jsdom does not implement. This one finishes as soon as
 *  it is asked for, so a list on its way out is gone a moment later. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}

/** The row the keyboard lands on is kept in view, and jsdom has no view. */
Element.prototype.scrollIntoView = () => undefined

/** The title bar's tab strip measures itself, and jsdom lays nothing out. */
class NoLayout {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

globalThis.ResizeObserver = NoLayout

const SPACES = [
  { id: 'vis', name: 'VIS', root: '/spaces/VIS' },
  { id: 'journal', name: 'Journal', root: '/spaces/Journal' },
]

let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  workspace.spaces = SPACES.map((one) => ({ ...one }))
  workspace.activeSpaceId = 'vis'
  workspace.panel = null
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
})

function head() {
  const made = mount(SpaceSwitcher, { target })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

function bar() {
  const made = mount(Titlebar, {
    target,
    props: { onpalette: () => undefined, onhistory: () => undefined },
  })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

const mark = () => target.querySelector<HTMLButtonElement>('[data-space-drop="switcher"]')
const list = () => target.querySelector('[role="menu"]')

/** A press on the header, and the list it drops once it is here: fetched with the first
 *  press (see SpaceMenu.svelte), which the launch's last turn has usually done already.
 *  Waits for that fetch itself, not for a while: compiling the menu on a cold cache
 *  took longer than `waitFor`'s second on a loaded machine. The markup's `{#await}`
 *  holds the same promise and was handed it first, so a turn after it the list is in. */
async function dropped() {
  mark()?.click()
  flushSync()
  await spacesMenu()
  await settled()
  expect(list()).not.toBe(null)
}

/** Long enough for a list on its way out to have gone: each animation it plays ends
 *  a turn after it starts, and leaving can be more than one; see the stand-in above. */
async function settled() {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

test('the shut panel leaves no space in the title bar', () => {
  bar()

  expect(target.querySelector('header [data-space-drop]')).toBe(null)
  expect(target.querySelector('header .nib-badge')).toBe(null)
  expect(target.querySelector('header')?.textContent).not.toContain('VIS')
})

test('a press on the header opens the switcher, and a row in it changes space', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  head()

  expect(list()).toBe(null)
  await dropped()

  // The switcher's own list: every space, and the one you are in picked out.
  expect(list()?.getAttribute('aria-label')).toBe('Spaces')
  expect(mark()?.getAttribute('aria-expanded')).toBe('true')
  const rows = [...(list()?.querySelectorAll<HTMLButtonElement>('.nib-row') ?? [])]
  expect(rows.map((one) => one.querySelector('.nib-row-label')?.textContent)).toEqual([
    'VIS',
    'Journal',
    'New space',
  ])
  expect(rows[0]?.classList.contains('is-on')).toBe(true)

  rows[1]?.click()
  await settled()

  expect(shown).toHaveBeenCalledWith('journal')
  expect(list()).toBe(null)
})

test('the list wears no numbers, and a digit typed into it still goes there', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  head()

  await dropped()
  // Emil, 2026-10-04: a number by every space was noise. They come with a digit or Alt,
  // as in the switcher in the middle of the window.
  expect(list()?.querySelector('.place')).toBe(null)

  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true, cancelable: true }),
  )
  await settled()

  expect(shown).toHaveBeenCalledWith('journal')
  expect(list()).toBe(null)
})

test('a second press puts the list away again', async () => {
  head()

  await dropped()
  expect(list()).not.toBe(null)

  mark()?.click()
  await settled()
  expect(list()).toBe(null)
  expect(mark()?.getAttribute('aria-expanded')).toBe('false')
})
