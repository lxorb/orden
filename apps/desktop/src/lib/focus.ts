/** Where the keyboard is, and how to put it somewhere else.
 *
 *  The regions are marked in the page with `data-region`, one attribute on an
 *  element that was already there, so the order F6 walks is the order the window
 *  is built in and cannot drift from it. Nothing here decides what the regions
 *  are or which one is next - that is regions.ts, which is arithmetic on a list
 *  and has the tests. This is the half that has to touch the DOM.
 *
 *  A region is entered at its first tab stop, which for a list is the row the
 *  roving tabindex left standing: the note you have open, not the top of the
 *  folder. See roving.ts. */

import { isRegion, type Region, REGIONS, stepRegion } from './regions'
import type { Panel } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** Everything a key can land on. `[tabindex="0"]` first, because that is what a
 *  composite widget leaves standing for Tab and is the row a region should be
 *  entered at; the rest is what a browser would have stopped on anyway. */
const FOCUSABLE =
  '[tabindex="0"], button, input, select, textarea, a[href], summary, [contenteditable="true"]'

/** Whether a key could actually land on it: not disabled, not hidden, not taken
 *  out of the tab sequence, and drawn somewhere. A button inside a panel that is
 *  slid off the side has no boxes at all. */
function reachable(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.matches(':disabled') || node.getAttribute('aria-hidden') === 'true') return false
  if (node.closest('[inert]')) return false
  if (node.tabIndex < 0) return false

  return node.getClientRects().length > 0
}

function boxOf(name: Region): HTMLElement | null {
  const found = document.querySelector(`[data-region="${name}"]`)
  return found instanceof HTMLElement && found.getClientRects().length > 0 ? found : null
}

/** The regions on screen. The sidebar may be shut, the strip belongs to a
 *  desktop, and the status bar is left out over a canvas: what is here is what
 *  the window happens to be drawing. */
function regionsOn(): Region[] {
  return REGIONS.filter((name) => boxOf(name) !== null)
}

/** Which region the keyboard is in. The nearest one wins, which is what a note
 *  inside a pane inside the panes needs. */
function regionHere(): Region | null {
  const at = document.activeElement
  const box = at instanceof Element ? at.closest('[data-region]') : null
  const name = box?.getAttribute('data-region')

  return isRegion(name) ? name : null
}

/** The first thing in a region a key can land on. */
function entryOf(name: Region): HTMLElement | null {
  const box = boxOf(name)
  if (!box) return null

  // A note is one element that takes the keyboard for the whole of itself, and
  // it is the element CodeMirror listens on rather than the box around it.
  const writing = box.querySelector('.cm-content')
  if (writing instanceof HTMLElement) return writing

  for (const one of box.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (reachable(one)) return one
  }

  // Nothing in it to stand on - a Links panel for a note nothing points at, a
  // status bar with no numbers showing - so the region itself takes the keyboard.
  // A region a key walks to has to be able to hold it, or the press lands on the
  // page and the next one starts from nowhere. The practices say the same: the
  // first thing in the region, else the region.
  if (box.tabIndex < 0 && !box.hasAttribute('tabindex')) box.tabIndex = -1
  return box
}

/** Puts the keyboard in a region. False where it is not on screen, which is what
 *  lets the caller open something and try again. */
function focusRegion(name: Region): boolean {
  const entry = entryOf(name)
  if (!entry) return false

  entry.focus()
  return true
}

/** The note. Every list gives the keyboard back to it, because the note is where
 *  people live. */
export function focusEditor(): boolean {
  return focusRegion('editor')
}

/** One region along, wrapping, from wherever the keyboard is. What F6 does.
 *
 *  A region that is on screen but has nothing to stand on is stepped over rather
 *  than stopped on, so the key never appears to do nothing. */
export function stepRegionFocus(direction: number): boolean {
  const present = regionsOn()
  let from: string | null = regionHere()
  // Once round at most: a window where nothing at all can hold the keyboard has to
  // end the walk rather than go round it for ever.
  let left = present.length

  while (left-- > 0) {
    const next = stepRegion(present, from, direction)
    if (!next) return false
    if (focusRegion(next)) return true
    from = next
  }

  return false
}

/** Opens a panel and puts the keyboard in it; pressing the same key again while
 *  the keyboard is already in it gives the note the keyboard back.
 *
 *  One key there and one key back, because the alternative is a key that opens
 *  something and a second key nobody remembers for leaving it. The panel has to
 *  be drawn before it can be stood in, so the second half waits a frame. */
export function revealPanel(panel: Panel): void {
  if (workspace.panel === panel && regionHere() === 'list') {
    focusEditor()
    return
  }

  if (workspace.panel !== panel) workspace.showPanel(panel)
  requestAnimationFrame(() => {
    focusRegion('list')
  })
}

/** Presses the one control a region is made of, at its own corner, so the menu
 *  it opens arrives under it rather than in the corner of the window.
 *
 *  The key presses the control the pointer would press: the menu is written once,
 *  in the component that owns it, and a chord for it is not a second copy of the
 *  same list. */
function pressRegion(name: Region): boolean {
  const entry = entryOf(name)
  if (!entry) return false

  entry.focus()
  const box = entry.getBoundingClientRect()
  entry.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(box.left + 8),
      clientY: Math.round(box.bottom),
    }),
  )

  return true
}

/** The space switcher, from anywhere: the sidebar's own header opens it, so the
 *  sidebar is opened first where it was shut. */
export function openSpaces(): void {
  if (pressRegion('space')) return

  workspace.showPanel('tree')
  requestAnimationFrame(() => {
    pressRegion('space')
  })
}
