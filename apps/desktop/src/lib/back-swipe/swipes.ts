/** A swipe over a pane, heard and answered: two fingers sideways on a touchpad, or one
 *  from the side of the pane on a screen, go back and forward along the tab's trail.
 *
 *  Two places a swipe is heard, and one machine for both (gesture.ts):
 *
 *  - **A note, a canvas, a PDF** - anything of the app's own - says it as the wheel and
 *    touch events of the window. Only inside a pane's content: never its strip of tabs,
 *    the sidebar, or under a layer that is open. What the content would scroll itself is
 *    asked of the content (edge.ts), and a wheel a surface took for itself - the canvas
 *    and the graph pan on it, a page note scrolls its column - is the surface's.
 *  - **A web page** is a webview of its own, whose events never reach the window. The
 *    page says what it saw instead, from nib's own world in it, and the crate says that
 *    here as `nib://web-swipe`; see src-tauri/src/web_swipe.rs.
 *
 *  A step is the tab's own Back or Forward (`workspace.goBack`, `goForward`), so a web
 *  tab walks the trail its arrows walk - a tab revived after a relaunch included - and a
 *  note tab walks the notes it has shown. Fetched as the launch ends; see `warmDoors`.
 *
 *  **The fingers on the pad.** A precision touchpad says, through the crate, how many
 *  fingers are on it (`nib://touchpad`; src-tauri/src/touchpad.rs). Once it has said so
 *  once, a touchpad's stream is the time two fingers are down: it starts when they land,
 *  is decided only when they lift, and everything after the lift until they land again -
 *  the pad's coast, a wheel that is not the pad - is nobody's. So one gesture is one step
 *  at most, however the coast runs, and a hand held still past the distance is only
 *  armed. Three fingers are Windows' own gestures, and end the stream as nothing.
 *
 *  **One swipe, one step,** where the pad says nothing. The touchpad's coast goes on after
 *  a swipe has gone, and the step itself can leave a gap in it - a page is replaced, a
 *  note is drawn - long enough to read as the fingers lifting. What arrives within
 *  `SETTLE` of that is the same coast, and nobody's.
 *
 *  **Every swipe ends** (#1119), in `end` and nowhere else, whatever stopped it: the hand
 *  lifting, gone quiet, cancelled, or landing again; another tab's or another hand's
 *  step; the window going out of sight; the setting turned off; the tab or its pane no
 *  longer shown (SwipeArrow.svelte); and, for a hand that says when it lifts and whose
 *  lift never came, nothing heard from it for `HOLD`. Ended, an arrow still out with the
 *  fingers plays out and goes: none outlives the stream it drew. */

import { mount, unmount } from 'svelte'
import { overlays } from '../overlays'
import { reading } from '../direction'
import { dur } from '../motion'
import { isDesktop, isMobile } from '../tauri'
import { viewport } from '../viewport.svelte'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { swipeChoice } from './choice.svelte'
import { chainOf, taken } from './edge'
import { QUIET, SETTLE, type Side, type Source, Swipe, type Turn } from './gesture'
import { type Room, swiping } from './shown.svelte'
import { Slid } from './slid'
import SwipeArrow from './SwipeArrow.svelte'

/** How near a pane's side a finger has to land to be a swipe and not a pan. */
export const SIDE = 24

/** How long the arrow plays out once a swipe is decided; see SwipeArrow.svelte. */
export const PLAYS = 210

/** How long a hand that says when it lifts - a finger, a touchpad that says so - may say
 *  nothing at all before it is taken to be gone, its lift lost on the way: the stream
 *  ends as nothing, and its arrow goes back. Not a moment, because such a hand held still
 *  is a swipe held, armed and waiting for the lift (#209; held three seconds in
 *  swipe-replays.json), and neither a pad held still nor a finger says anything while it
 *  is. In milliseconds. */
export const HOLD = 4_000

/** Both ways taken: what a surface that kept the scroll for itself says. */
const KEPT: Record<Side, boolean> = { left: true, right: true }

/** Neither: what a step that is not asked says, one straight down or one the stream has
 *  decided already. */
const NEITHER: Record<Side, boolean> = { left: false, right: false }

/** One step of a swipe, from wherever it was heard. `at` is on the clock of whatever
 *  heard it, which only ever compares it with its own steps. */
export interface Heard {
  tab: Tab
  source: Source
  dx: number
  dy: number
  at: number
  scrolls: Record<Side, boolean>
}

/** The stream being heard, if any: one at a time, over one tab. */
interface Live {
  swipe: Swipe
  tab: Tab
  source: Source
  /** Whether the hand says when it lifts: a finger, or a touchpad that has said so. */
  told: boolean
  /** Whether the arrow has been out, so a decision is played rather than skipped. */
  shown: boolean
  /** Whether a step has been taken for it, so a coast cannot take a second. */
  stepped: boolean
  /** Whether that step went, so what follows it settles first. */
  went: boolean
  /** Whether it began while the last swipe's coast was settling: then it is that coast,
   *  and every step of it is nobody's. */
  swallowed: boolean
  /** The first step's time, and the last step's, on its own clock; and the last on this
   *  window's. */
  first: number
  at: number
  heardAt: number
  /** Where the arrow comes in, measured once as the arrow first comes out rather than at
   *  every step: a step is drawn by the compositor, never by a layout. */
  room: Room | null
}

let live: Live | null = null
/** What ends the stream if nothing more is heard of it: `QUIET`, or `HOLD`. */
let quiet: ReturnType<typeof setTimeout> | undefined
let clearing: ReturnType<typeof setTimeout> | undefined
/** Until when, on this window's clock, a touchpad's new stream is the last swipe's coast. */
let settling = 0

/** What the touchpad has said of the fingers on it: whether it says anything at all, and
 *  whether two or more are down now. */
const pad = { known: false, down: false }

/** Which way a side goes: Back at the left, unless the interface reads right to left,
 *  where the history runs the other way across the screen too. */
export function wayOf(side: Side): 'back' | 'forward' {
  const back: Side = reading() === 'rtl' ? 'right' : 'left'
  return side === back ? 'back' : 'forward'
}

/** Whether `tab` has somewhere to go at each side. */
function goes(tab: Tab): Record<Side, boolean> {
  const can = (side: Side) => {
    const way = wayOf(side)
    if (tab.kind === 'web') {
      const page = pages.of(tab.id)
      return way === 'back' ? page.back : page.forward
    }
    return way === 'back' ? tab.canGoBack : tab.canGoForward
  }
  return { left: can('left'), right: can('right') }
}

/** The pane a tab is shown in. */
function paneOf(tab: Tab): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[data-pane]')
  return Array.from(all).find((one) => one.dataset.pane === tab.paneId) ?? null
}

/** What of a pane the arrow comes in over: a web tab's page, or everything under the
 *  pane's own head. */
function roomOf(pane: HTMLElement): Room {
  const page = pane.querySelector('.hole')
  const box = (page ?? pane).getBoundingClientRect()
  const head = page ? null : Array.from(pane.children).find((one) => one.classList.contains('head'))
  const top = head ? Math.max(box.top, head.getBoundingClientRect().bottom) : box.top
  return { x: box.left, y: top, width: box.width, height: box.bottom - top }
}

/** Says where the arrow is now, in the turn the step was heard in: nothing waits for a
 *  frame, a timer or an answer from anywhere (#1050). */
function draw(one: Live) {
  const { phase, side, progress } = one.swipe.shown
  if (!one.room) {
    const pane = paneOf(one.tab)
    if (!pane) return
    one.room = roomOf(pane)
  }
  swiping.tab = one.tab.id
  swiping.pane = one.tab.paneId
  swiping.room = one.room
  swiping.side = side
  swiping.stage = phase === 'went' ? 'went' : phase === 'stayed' ? 'stayed' : 'tracking'
  swiping.progress = progress
  swiping.travel = one.swipe.shown.travel
  swiping.turn++
}

/** The arrow plays out and goes. */
function played() {
  clearTimeout(clearing)
  clearing = setTimeout(gone, dur(PLAYS))
}

/** No arrow at all. */
function gone() {
  clearTimeout(clearing)
  swiping.tab = null
  swiping.pane = null
  swiping.room = null
  swiping.progress = 0
  swiping.travel = 0
  swiping.turn++
}

/** A decided swipe, acted on once: the step, if it went, and the arrow played out. */
function decided(one: Live, phase: 'went' | 'stayed', side: Side) {
  if (one.stepped) return
  one.stepped = true
  one.went = phase === 'went'
  if (one.shown) {
    swiping.stage = phase
    swiping.turn++
    played()
  }
  if (phase !== 'went') return
  if (wayOf(side) === 'back') workspace.goBack(one.tab.id)
  else workspace.goForward(one.tab.id)
}

/** One step of whichever stream it belongs to. A step over another tab, or from another
 *  kind of hand, ends the stream before it. */
export function heard(step: Heard): void {
  if (!swipeChoice.on) {
    end('dropped')
    return
  }
  // The fingers are off the pad: the coast of a gesture already decided, or a wheel
  // that is not the pad's. Nobody's.
  if (step.source === 'touchpad' && pad.known && !pad.down) return
  if (live && (live.tab.id !== step.tab.id || live.source !== step.source)) end('lifted')

  const now = performance.now()
  const told = step.source === 'touch' || pad.known
  live ??= {
    swipe: new Swipe(step.source, () => ({ width: innerWidth, height: innerHeight }), told),
    tab: step.tab,
    source: step.source,
    told,
    shown: false,
    stepped: false,
    went: false,
    swallowed: !told && now < settling,
    first: step.at,
    at: step.at,
    heardAt: now,
    room: null,
  }
  const one = live
  one.at = step.at
  one.heardAt = now
  // A touchpad never says it was let go of; a finger does. See gesture.ts. Gone quiet,
  // it was let go of that long after its last step, on that step's own clock. One that
  // says, and says nothing for `HOLD`, lost its lift on the way.
  clearTimeout(quiet)
  quiet = one.told
    ? setTimeout(() => end('dropped'), HOLD)
    : setTimeout(() => end('lifted', step.at + QUIET), QUIET)
  if (one.swallowed) return

  const turn: Turn = {
    dx: step.dx,
    dy: step.dy,
    at: step.at,
    scrolls: step.scrolls,
    goes: goes(step.tab),
  }
  const shown = one.swipe.turn(turn)

  // Out with the fingers from the first step that leans towards somewhere to go, before
  // the stream is a swipe; see gesture.ts.
  if (shown.phase === 'tracking' || (shown.phase === 'gathering' && shown.travel > 0)) {
    clearTimeout(clearing)
    one.shown = true
    draw(one)
  } else if (shown.phase === 'gathering' && one.shown) {
    draw(one)
  } else if (shown.phase === 'content' && one.shown && !one.stepped) {
    // It was a scroll after all: the arrow goes back the way it came, and nothing steps.
    one.stepped = true
    swiping.stage = 'stayed'
    swiping.turn++
    played()
  } else if ((shown.phase === 'went' || shown.phase === 'stayed') && !one.stepped) {
    if (one.shown) draw(one)
    decided(one, shown.phase, shown.side)
  }
}

/** The stream is over, and this is the one place any stream ends; see the top.
 *  `lifted` is the hand letting go, which decides a swipe that was tracking; `at` is on
 *  the stream's own clock, and left out - a stream cut short by another - it is as long
 *  after its last step as this window has waited since hearing it. `dropped` is a stream
 *  that ends as nothing: nothing is stepped. Either way the next step starts another,
 *  and an arrow still out with the fingers goes back the way it came. */
function end(how: 'lifted' | 'dropped', at?: number): void {
  clearTimeout(quiet)
  const one = live
  live = null
  if (!one || one.swallowed) return
  if (how === 'lifted') {
    const when = at ?? one.at + (performance.now() - one.heardAt)
    const shown = one.swipe.lift(when)
    // A stream the content kept, or one a coast decided already, leaves nothing to decide.
    if (shown.phase === 'went' || shown.phase === 'stayed') {
      if (one.shown) draw(one)
      decided(one, shown.phase, shown.side)
    }
    if (one.went && !one.told) settling = performance.now() + SETTLE
  }
  // Let go before it was a swipe at all - out as it leaned sideways - or dropped.
  if (one.shown && !one.stepped) decided(one, 'stayed', one.swipe.shown.side)
}

/** How many fingers are on the touchpad now, as the crate says it. Two landing start a
 *  gesture and two lifting end it, decided there; a third is Windows' own. See the top. */
export function touchpad(fingers: number): void {
  pad.known = true
  if (fingers >= 3) {
    if (live?.source === 'touchpad') end('dropped')
    pad.down = false
    return
  }
  const down = fingers >= 2
  if (down === pad.down) return
  pad.down = down
  if (live?.source !== 'touchpad') return
  // Landing again with a stream still open is one whose lift was never heard.
  end(down ? 'dropped' : 'lifted')
}

/** The tab a window event is over, when it is one a swipe may start on: inside a pane's
 *  content, under no layer, and not a web tab, whose page says its own. */
function tabUnder(target: EventTarget | null): { tab: Tab; pane: HTMLElement; at: Element } | null {
  if (!(target instanceof Element) || overlays.depth > 0) return null
  const pane = target.closest<HTMLElement>('[data-pane]')
  if (!pane || target.closest('[data-chrome]')) return null
  const tab = workspace.showing(pane.dataset.pane ?? '')
  if (!tab || tab.kind === 'web') return null
  return { tab, pane, at: target }
}

/** Whether a wheel is a touchpad's: in pixels, with no key held, and - to start a stream
 *  - not a tilted wheel's notch: Chrome never swipes on a mouse. Inside a stream a step
 *  that happens to add up to a whole notch is still the stream's; the engine adds up
 *  what arrives within a frame. */
export function fromTouchpad(event: WheelEvent, streaming: boolean): boolean {
  if (event.deltaMode !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
    return false
  }
  const notch = 'wheelDeltaX' in event ? Number(event.wheelDeltaX) : 0
  return streaming || !(notch !== 0 && notch % 120 === 0)
}

/** Which pane's content each scroll moved sideways, and when; see slid.ts. */
const slid = new Slid()

function scrolled(event: Event) {
  if (!(event.target instanceof Element)) return
  const pane = event.target.closest<HTMLElement>('[data-pane]')?.dataset.pane ?? null
  slid.heard(event.target, pane, event.timeStamp)
}

/** Which way the content under a wheel would take it, asked only where the answer counts:
 *  a sideways step of a stream that has not decided yet. A stream that has moved the
 *  pane's content sideways already is the content's, wherever the content stands now: a
 *  passive listener hears the wheel after the scroll it made (#407; see slid.ts). */
function scrollsUnder(event: WheelEvent, under: { tab: Tab; pane: HTMLElement; at: Element }) {
  if (event.defaultPrevented) return KEPT
  const ours = live?.tab.id === under.tab.id ? live : null
  if (ours && !ours.swipe.asking) return NEITHER
  if (slid.since(under.tab.paneId, ours?.first ?? event.timeStamp)) return KEPT
  if (event.deltaX === 0) return NEITHER
  return taken(chainOf(under.at, under.pane))
}

function wheeled(event: WheelEvent) {
  if (!swipeChoice.on || !fromTouchpad(event, live !== null)) return
  // Every step, one straight down included: which way a stream goes is read from its
  // first. See gesture.ts.
  if (event.deltaX === 0 && event.deltaY === 0) return
  const under = tabUnder(event.target)
  if (!under) return
  heard({
    tab: under.tab,
    source: 'touchpad',
    dx: event.deltaX,
    dy: event.deltaY,
    at: event.timeStamp,
    scrolls: scrollsUnder(event, under),
  })
}

/** The finger on the screen, from the moment it landed at a pane's side. */
let finger: { tab: Tab; x: number; y: number; scrolls: Record<Side, boolean> } | null = null

function touched(event: TouchEvent) {
  finger = null
  // A finger landing with a finger's stream still open: that one's lift was never heard.
  if (live?.source === 'touch') end('dropped')
  const touch = event.touches[0]
  // A tablet held upright pulls its drawers out from the sides; see drawer-follow.ts.
  if (!swipeChoice.on || viewport.drawer || event.touches.length !== 1 || !touch) return
  const under = tabUnder(event.target)
  if (!under) return
  const room = roomOf(under.pane)
  const fromSide = touch.clientX - room.x <= SIDE || room.x + room.width - touch.clientX <= SIDE
  if (!fromSide) return
  finger = {
    tab: under.tab,
    x: touch.clientX,
    y: touch.clientY,
    scrolls: taken(chainOf(under.at, under.pane)),
  }
}

function moved(event: TouchEvent) {
  const touch = event.touches[0]
  if (!finger || !touch) return
  if (event.touches.length !== 1) {
    released(event)
    return
  }
  // A finger moving right scrolls towards the left, as two fingers on a pad do.
  heard({
    tab: finger.tab,
    source: 'touch',
    dx: finger.x - touch.clientX,
    dy: finger.y - touch.clientY,
    at: event.timeStamp,
    scrolls: finger.scrolls,
  })
  finger.x = touch.clientX
  finger.y = touch.clientY
}

function released(event: TouchEvent) {
  finger = null
  if (live?.source === 'touch')
    end(event.type === 'touchcancel' ? 'dropped' : 'lifted', event.timeStamp)
}

/** What the crate says a page saw; see src-tauri/src/web_swipe.rs. */
export interface Said {
  tab: string
  kind: 'wheel' | 'touch' | 'lift'
  dx: number
  dy: number
  at: number
  left: boolean
  right: boolean
}

export function readSaid(value: unknown): Said | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const { tab, kind, dx, dy, at, left, right } = said
  if (typeof tab !== 'string' || (kind !== 'wheel' && kind !== 'touch' && kind !== 'lift'))
    return null
  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof at !== 'number') return null
  return { tab, kind, dx, dy, at, left: left === true, right: right === true }
}

/** How many fingers the crate says are on the touchpad; see src-tauri/src/touchpad.rs. */
export function readFingers(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const { fingers } = value as Record<string, unknown>
  return typeof fingers === 'number' && Number.isInteger(fingers) && fingers >= 0 ? fingers : null
}

/** A page's swipe, in the window's pixels: a page zoomed in reports its own, smaller
 *  ones. */
export function pageSaid(said: Said): void {
  // A lift ends its stream whatever has happened since it began: a layer come up, the
  // tab gone.
  if (said.kind === 'lift') {
    if (live?.tab.id === said.tab) end('lifted', said.at)
    return
  }
  const tab = workspace.tabs.find((one) => one.id === said.tab)
  if (tab?.kind !== 'web' || overlays.depth > 0) return
  const zoom = pages.of(tab.id).zoom || 1
  heard({
    tab,
    source: said.kind === 'touch' ? 'touch' : 'touchpad',
    dx: said.dx * zoom,
    dy: said.dy * zoom,
    at: said.at,
    scrolls: { left: said.left, right: said.right },
  })
}

/** The window went out of sight: whatever the hand does now, this window will not hear
 *  it lift. Not the window losing the focus, which is also a page taking it - a finger
 *  landing on a web page does - and what a precision touchpad says of a lift reaches
 *  the window behind another all the same; see src-tauri/src/touchpad.rs. */
function away() {
  if (document.visibilityState === 'hidden') end('dropped')
}

/** The tab the arrow is over is no longer the one its pane shows - another chosen, it
 *  closed, the pane gone - so the stream ends, and the arrow with it at once. */
function unseen() {
  end('dropped')
  gone()
}

/** Starts hearing swipes, and puts the arrow on the window. Answers the way to stop. */
export function listen(): () => void {
  const target = document.createElement('div')
  document.body.append(target)
  const arrow = mount(SwipeArrow, { target, props: { unseen } })

  window.addEventListener('wheel', wheeled, { passive: true })
  window.addEventListener('scroll', scrolled, { capture: true, passive: true })
  document.addEventListener('visibilitychange', away)
  // A phone has the system's own back at the side of the screen.
  const touching = !isMobile
  if (touching) {
    window.addEventListener('touchstart', touched, { capture: true, passive: true })
    window.addEventListener('touchmove', moved, { capture: true, passive: true })
    window.addEventListener('touchend', released, { capture: true, passive: true })
    window.addEventListener('touchcancel', released, { capture: true, passive: true })
  }

  let unlisten: (() => void) | null = null
  let stopped = false
  if (isDesktop) {
    void import('../own-window').then(async ({ hearHere }) => {
      const off = await hearHere('nib://web-swipe', (event) => {
        const said = readSaid(event.payload)
        if (said) pageSaid(said)
      })
      const offPad = await hearHere('nib://touchpad', (event) => {
        const fingers = readFingers(event.payload)
        if (fingers !== null) touchpad(fingers)
      })
      const both = () => {
        off()
        offPad()
      }
      if (stopped) both()
      else unlisten = both
    })
  }

  return () => {
    stopped = true
    unlisten?.()
    window.removeEventListener('wheel', wheeled)
    window.removeEventListener('scroll', scrolled, { capture: true })
    document.removeEventListener('visibilitychange', away)
    slid.forget()
    if (touching) {
      window.removeEventListener('touchstart', touched, { capture: true })
      window.removeEventListener('touchmove', moved, { capture: true })
      window.removeEventListener('touchend', released, { capture: true })
      window.removeEventListener('touchcancel', released, { capture: true })
    }
    end('dropped')
    gone()
    settling = 0
    pad.known = false
    pad.down = false
    void unmount(arrow)
    target.remove()
  }
}
