/** What of a web tab's page the app's own layers are over.
 *
 *  A page is a native webview that draws above every pixel of the window's HTML, so
 *  something of the app's over a page has to be answered by the page. It used to be
 *  answered by hiding the whole page whenever anything at all was open - a tab's hover
 *  card over the strip, a menu over the file list - and every page in the window stepped
 *  behind a still picture of itself, or behind nothing where there was no picture yet.
 *  Emil, 2026-10-03: *"While a toast shows or while hovering things, the website is
 *  sometimes invisible until he stops."*
 *
 *  So the question is asked of each page and of each layer: which of the app's layers
 *  are over *this* page, and where. A layer beside the page leaves it alone. A layer
 *  that floats over it - a menu, a dropdown, a card, a site's popover under the bar - is
 *  cut out of the page in its own shape, and the page goes on being the page around it
 *  (see src-tauri/src/web_cut.rs). A scrim covers the whole window, so a sheet over one
 *  covers all of the page, and so does a clear one: it is there to catch the press
 *  outside the menu, and a page left over it would take that press.
 *
 *  The layers are found by one registry, `COVERS` below: the shapes the theme package
 *  gives them, `.nib-layer`, `.nib-bubble`, `.nib-screen` and `.nib-scrim`, so a layer
 *  written tomorrow in one of them is covered on the day it is written; the row the app's
 *  own notices float in over the foot of the panes, whatever each card in it wears (see
 *  `.notices` in App.svelte); and `data-covers` on a layer that wears none of the
 *  shapes - a drag's ghost, a lightbox, a catch under a picker. test/covers.test.ts
 *  reads every component and fails for a layer of the window that is in none of them
 *  (#1124). Anything else over the page is found by the hit test the pane has always
 *  done, and covers all of it, which is the safe answer for a thing nothing here knows
 *  the shape of.
 *
 *  **Heard in the breath it changes** (#1124). A layer is answered from the moment it is
 *  in the document, shown, hidden or moved, rather than on the next press or a timer
 *  after it. Reported on Windows, 2026-11-04: a menu opened from somewhere else, a
 *  popover, a sheet, the tab overview drawn behind the page, or right only a second later.
 *  See `watchArrivals`. */

import type { Rect } from './pages.svelte'

/** One of the app's layers over a page, in the page's own coordinates, with its corner. */
interface Hollow extends Rect {
  radius: number
}

/** What of a page is under the app's layers: all of it, and the layers themselves. */
export interface Cut {
  all: boolean
  hollows: Hollow[]
}

/** Something of the app's on the window, as `layersOver` finds it. */
export interface Layer {
  box: Rect
  radius: number
  /** A scrim, clear or not, which covers the whole window; otherwise a floating layer. */
  scrim: boolean
  /** A card in the notices row, which stands at the foot of the panes; see `clearOf`. */
  notice?: boolean
  /** The element itself, which the page watches for a change of size; see WebTab.svelte. */
  node?: Element
}

/** The row the app's notices float in: a toast, the update notice, the storage card,
 *  the recording pill. See `.notices` in App.svelte. */
const NOTICES = '[data-notices]'
/** And each card in it, whatever it wears. */
const CARDS = `${NOTICES} > *`

/** What of a page each kind of the app's layers covers: the one list of them.
 *
 *  `floating` is cut out of the page in its own shape: the shapes the theme package
 *  gives every layer that floats (see base.css), the arrow a swipe brings in over a page,
 *  which is round and moves with the fingers (see back-swipe/SwipeArrow.svelte), and a
 *  file flying to the downloads glyph, which moves by itself (see downloads/flight.ts).
 *  `whole` covers all of a page, dimming it or not: a scrim, and the room a swipe's arrow
 *  comes in over while the fingers are on.
 *
 *  A layer that wears none of the shapes says which it is with `data-covers`: bare for
 *  its own shape, `all` for all of the page. */
export const COVERS = {
  floating: ['nib-layer', 'nib-bubble', 'nib-screen', 'nib-swipe', 'nib-flight'],
  whole: ['nib-scrim', 'nib-swipe-room'],
} as const

const FLOATING = [
  ...COVERS.floating.map((one) => `.${one}`),
  '[data-covers]:not([data-covers="all"])',
  CARDS,
].join(', ')
const SCRIMS = [...COVERS.whole.map((one) => `.${one}`), '[data-covers="all"]'].join(', ')
/** Any of them. */
const ANY = `${FLOATING}, ${SCRIMS}`

function meets(one: Rect, other: Rect): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

/** What of a page at `hole` the layers cover, or null for none of it. Pure. */
export function cutOf(hole: Rect, layers: readonly Layer[]): Cut | null {
  const over = layers.filter(
    (one) => one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
  if (over.length === 0) return null

  return {
    all: over.some((one) => one.scrim),
    hollows: over
      .filter((one) => !one.scrim)
      .map((one) => ({
        x: one.box.x - hole.x,
        y: one.box.y - hole.y,
        width: one.box.width,
        height: one.box.height,
        radius: one.radius,
      })),
  }
}

/** A cut of all of the page. */
export const ALL: Cut = { all: true, hollows: [] }

/** What of a cut the crate is told, once the page is hidden whole behind its still
 *  picture: all of it, and nothing of the layers over it, which move over the picture
 *  and not over the page. A swipe's arrow moves on every step (#1050), and each move
 *  told was a placement of the page and a fresh photograph of it every few tenths of a
 *  second, for a page nobody could see. The layers still count while there is no
 *  picture, on an engine that cuts them out round each one; one that cannot cut hides
 *  the page whole either way. */
export function settled(cut: Cut | null, pictured: boolean, cuts: boolean): Cut | null {
  return cut?.all && (pictured || !cuts) ? ALL : cut
}

/** How much of a page has to be left above the notices for the page to stand clear of
 *  them rather than behind its still: half of it. */
const LEFT = 0.5

/** Where a page goes on an engine that cannot cut, and the layers still over it there.
 *
 *  Such an engine can only answer a layer by hiding the page behind its still, and a
 *  notice is up for as long as nobody answers it - the update notice for a whole day -
 *  with the page behind a picture of itself all that time, or behind nothing where
 *  there was no picture yet. A notice stands at the foot of the panes, so the page is
 *  ended above it instead, the way Chrome gives its download bar and its infobars room
 *  of their own rather than drawing them over the page: the page stays live, and the
 *  notice is in a band of the pane's own. Only where that leaves the page most of its
 *  height; past that, the notices are layers like any other. Pure. */
export function clearOf(hole: Rect, layers: readonly Layer[]): { box: Rect; layers: Layer[] } {
  const notices = layers.filter(
    (one) => one.notice && one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
  if (notices.length === 0) return { box: hole, layers: [...layers] }

  const top = Math.min(...notices.map((one) => one.box.y))
  const height = Math.floor(top - hole.y)
  if (height < hole.height * LEFT) return { box: hole, layers: [...layers] }
  return {
    box: { ...hole, height },
    layers: layers.filter((one) => !notices.includes(one)),
  }
}

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** Whether a layer is drawn at all. A hint in the sidebar foot stays in the document
 *  while the sidebar is shut, hidden with the column it stands in and still laid out
 *  over the foot of the page beside it - and a page cut round it showed an empty box
 *  where nothing was. Not its opacity: a layer fading in starts at none, and is a layer
 *  from its first frame. An engine with no way to ask draws it, as before. */
function seen(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}

/** Every layer of the app's on the window that is drawn, but those inside `hole` itself -
 *  a card the pane draws in its own room is under the page by design. */
export function layersOver(hole: HTMLElement): Layer[] {
  const found: Layer[] = []
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node) || !seen(node)) continue
    const scrim = node.matches(SCRIMS)
    found.push({
      box: boxOf(node),
      radius: scrim ? 0 : parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
      scrim,
      notice: node.matches(CARDS),
      node,
    })
  }
  return found
}

/** Whether any layer is still moving in or out: its shape has not settled, so the page
 *  is asked again next frame. */
export function moving(hole: HTMLElement): boolean {
  for (const node of document.querySelectorAll(ANY)) {
    if (hole.contains(node)) continue
    if (node.getAnimations().some((one) => one.playState === 'running')) return true
  }
  return false
}

/** Whether something nothing here knows the shape of is over the page: the hit test at
 *  nine points the pane has always done, less the layers already found. */
export function strangerOver(hole: HTMLElement): boolean {
  const box = hole.getBoundingClientRect()
  for (const x of [0.08, 0.5, 0.92]) {
    for (const y of [0.08, 0.5, 0.92]) {
      const on = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
      if (on === null || on === hole || hole.contains(on)) continue
      if (on.closest(ANY)) continue
      return true
    }
  }
  return false
}

/** The rows the app's notices float in. A notice comes and goes without a press and is
 *  on no overlay stack, so a page hears of one by watching the row change size: empty,
 *  it has none. */
export function noticeRows(): Element[] {
  return [...document.querySelectorAll(NOTICES)]
}

/** Whether a change to the document brought a layer or took one away, or showed, hid or
 *  moved one: a node that is one or holds one put in or taken out, any card put in or
 *  taken out of the notices row - which, once out of the row, no longer matches the
 *  selector that found it - and a change to the class, the style or the `hidden` of a
 *  layer or of something holding one.
 *
 *  The last is what was missing (#1124). A layer shown by a class or a style rather than
 *  by being put in - the window's bar sliding down over a tab that fills it, the tab
 *  overview's ground fading in from hidden, a swipe's room, a ghost following a drag - is
 *  no node put in or taken out, and the page heard of it on the next press or a fifth
 *  of a second after it, if at all. Pure but for the nodes it is handed. */
export function bringsLayer(
  record: Pick<MutationRecord, 'target' | 'addedNodes' | 'removedNodes'> & {
    type?: MutationRecordType
  },
): boolean {
  if (record.type === 'attributes') {
    const on = record.target
    return on instanceof Element && (on.matches(ANY) || on.querySelector(ANY) !== null)
  }
  if (record.target instanceof Element && record.target.matches(NOTICES)) return true
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(ANY) || node.querySelector(ANY) !== null) return true
    }
  }
  return false
}

/** What of an element can show, hide or move a layer without putting one in. */
const SHOWN_BY = ['class', 'style', 'hidden', 'data-covers']

const told = new Set<() => void>()
let arriving: MutationObserver | null = null

/** Says to `tell` whenever a layer comes into the window or leaves it, or is shown,
 *  hidden or moved, whatever did it. Most layers arrive by a press or on the overlay
 *  stack, which every page already hears; these do not - a hint, a card a row puts up
 *  under the pointer, the second toast in a row that did not change size, a bar slid down
 *  by a class, a layer written tomorrow by somebody who never heard of the stack - and a
 *  page that never heard of one left it drawn behind the page.
 *
 *  Said as the document changes, before the frame that draws the change: an observer's
 *  answer comes once whatever changed the document has finished, ahead of the next
 *  paint, so a pane that looks again at once is cut or hidden for the layer in the frame
 *  the layer is first drawn in, and whole again in the frame it goes. One observer for
 *  the window, however many pages listen. */
export function watchArrivals(tell: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => undefined
  told.add(tell)
  arriving ??= new MutationObserver((records) => {
    if (!records.some(bringsLayer)) return
    for (const one of told) one()
  })
  if (told.size === 1) {
    arriving.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: SHOWN_BY,
    })
  }
  return () => {
    told.delete(tell)
    if (told.size === 0) arriving?.disconnect()
  }
}
