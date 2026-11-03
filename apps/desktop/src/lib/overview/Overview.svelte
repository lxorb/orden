<script lang="ts">
  /** Every tab as a window on a canvas, Alt Alt (issue #331).
   *
   *  Not a sheet of cards over the tabs: the tabs become the windows. The tab in front of
   *  each pane shrinks out of the pane, the others come down out of the strip from where
   *  each tab sits, and they land on a blurred canvas laid out the way the panes are - a
   *  split's sides side by side with a curve between them (layout.ts). A press on one
   *  opens it: it grows back into its pane while the rest go home to the strip. Alt Alt
   *  again, Escape, or a press on the canvas send every window home.
   *
   *  Every window is one element on springs from the tab it was to the window it is
   *  (flight.ts), so a change of mind mid-flight turns it round from where it is, at the
   *  speed it had. The springs write the styles themselves, once a frame, and nothing is
   *  laid out while anything flies. Asked for less movement, the windows are simply
   *  where they go.
   *
   *  A window can be dragged: it stays under the hand exactly, the others make room for it
   *  where it would land, and letting go moves the tab there - along its pane's strip, or
   *  into another pane's (drag.ts).
   *
   *  All spaces shows the other spaces too, each in its place on the one canvas inside a
   *  living membrane (Cells.svelte); a window dragged out of its cell stretches it, and
   *  dragged well into another's plops across, which moves its tab to that space when it
   *  is let go (cells.ts). */

  import { untrack } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { t } from '../i18n.svelte'
  import { chorded } from '../keys'
  import { stillness } from '../motion'
  import { overlays } from '../overlays'
  import SpaceBadge from '../SpaceBadge.svelte'
  import { tabOverview } from '../surfaces.svelte'
  import TabMark from '../TabMark.svelte'
  import { trap } from '../trap'
  import { pages } from '../web-tab/pages.svelte'
  import { isUnsaved } from '../workspace/drafts'
  import { type Tab, workspace } from '../workspace.svelte'
  import {
    boxToCanvas,
    type Camera,
    lookingAt,
    pinched,
    type Point,
    showing,
    toCanvas,
    turned,
    moved as panned,
  } from './camera'
  import { isDrag, type Landing, landingAt, MADE, withLanding, withMoved } from './drag'
  import { places } from './places.svelte'
  import { type Cell, cellAt, withPlop } from './cells'
  import Cells from './Cells.svelte'
  import { keep, storedText } from '../stored'
  import { canWriteAt } from '../sharing.svelte'
  import { mayCarry } from '../workspace/chat-carry'
  import { panesIn, type Frame } from '../workspace/pane-tree'
  import { movingOf, spacesFor } from '../workspace/space-move'
  import { drawn, Flight, type Pose } from './flight'
  import { around, type Box, type Laid, lay, seamPath, type Slot } from './layout'
  import { marked, mirrorOf, shownBox } from './mirror'
  import { walk, wayOf } from './walk'
  import WindowFace from './WindowFace.svelte'

  /** Whether the layer is on screen at all: from the first frame out until the last
   *  window is home. */
  let shown = $state(false)
  /** Whether the windows are out on the canvas, or on their way home. */
  let out = $state(false)

  let width = $state(window.innerWidth)
  let height = $state(window.innerHeight)

  /** The room the windows are laid out in: the window, less a margin and the row of
   *  spaces at the top. */
  const MARGIN = 56
  const TOP = 88

  /** What each pane showed as the layer came up, which its windows take the shape of. */
  let panes = $state<Record<string, { w: number; h: number }>>({})
  /** The copy of each pane's tab in front, by tab. */
  let mirrors = $state<Record<string, HTMLElement>>({})

  const frame = $derived(workspace.panes.frame)
  /** The room the windows are laid out in on the screen, at one to one. */
  const screenRoom = $derived<Box>({
    x: MARGIN,
    y: TOP,
    w: Math.max(width - 2 * MARGIN, 200),
    h: Math.max(height - TOP - MARGIN, 160),
  })

  /** Which space's place the canvas lays this set of tabs out in: the space's own, or the
   *  window's while it is in none. */
  const spaceKey = $derived(workspace.activeSpaceId ?? 'global')
  /** Where on the one canvas, kept from run to run (places.svelte.ts). */
  const room = $derived<Box>(
    places.at(spaceKey) ?? { x: 0, y: 0, w: screenRoom.w, h: screenRoom.h },
  )

  /** Where the canvas is looked at from (camera.ts). */
  let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 })

  /** The camera on the space being worked in, its place given it if it has none yet. */
  function lookAtSpace() {
    const place = places.place(spaceKey, { w: screenRoom.w, h: screenRoom.h })
    camera = lookingAt(place, screenRoom)
  }

  const shapeOf = (paneId: string): number => {
    // The pane a window against a side would make: half the pane it splits.
    const landing = held?.landing
    if (paneId === MADE && landing?.kind === 'side') {
      const half = shapeOf(landing.paneId)
      return landing.side === 'left' || landing.side === 'right' ? half / 2 : half * 2
    }
    const measured = shownBox(paneId)
    const box = panes[paneId] ?? (measured && { w: measured.width, h: measured.height })
    return box && box.w > 0 && box.h > 0 ? box.w / box.h : 16 / 10
  }

  const tabsOf = (paneId: string) => workspace.tabsIn(paneId).map((tab) => tab.id)

  /** Current space or All spaces: whether the other spaces' cells are shown as well. The
   *  same view either way. Remembered on this device. */
  const ALL = 'nib:overview-all'
  let all = $state(storedText(ALL) === 'yes')

  function showAll(on: boolean) {
    all = on
    keep(ALL, on ? 'yes' : 'no')
  }

  /** The other spaces' panes, which the store of every space's set holds; fetched the
   *  first time All spaces is shown (workspace/sets.svelte.ts). */
  let sets = $state<{ frameOf: (key: string) => Frame | null } | null>(null)
  $effect(() => {
    if (all && !sets) void import('../workspace/sets.svelte').then((one) => (sets = one.sets))
  })

  /** The spaces whose windows are on the canvas: the one worked in first, and in All
   *  spaces every other that has panes. */
  const shownKeys = $derived.by((): string[] => {
    const others = all && sets && workspace.activeSpaceId ? workspace.shownSpaces : []
    const keys = others.map((one) => one.id).filter((key) => key !== spaceKey && sets?.frameOf(key))
    return [spaceKey, ...keys]
  })

  /** Each space shown is given its place on the canvas, once (places.svelte.ts). */
  $effect(() => {
    for (const key of shownKeys)
      untrack(() => places.place(key, { w: screenRoom.w, h: screenRoom.h }))
  })

  /** The window under the hand: which, where it was taken hold of (as a share of its
   *  width and height), and where it would land now. */
  let held = $state<{
    id: string
    fx: number
    fy: number
    landing: Landing | null
    /** The space whose cell it was taken out of, and those it may go to. */
    from: string
    goes: readonly string[]
  } | null>(null)

  /** The canvas without the window being dragged, which says where it would land. */
  const without = $derived(
    held
      ? lay(frame, room, {
          tabsOf: (paneId) => tabsOf(paneId).filter((one) => one !== held?.id),
          shapeOf,
        })
      : null,
  )

  /** The canvas as it is, or with the held window where it would land - in a pane of
   *  its own where it is against a side of one (drag.ts). */
  const laidCells = $derived(
    shownKeys.flatMap((key) => {
      const own = key === spaceKey
      const panesOf = own ? frame : sets?.frameOf(key)
      if (!panesOf) return []
      const place = own ? room : (places.at(key) ?? room)
      // A window over another cell is laid out at the end of that cell's first pane.
      const plop = held?.landing?.kind === 'space' ? held.landing : null
      let ofCell: (paneId: string) => readonly string[] = tabsOf
      if (held && plop) {
        const first = key === plop.key ? (panesIn(panesOf)[0]?.id ?? null) : null
        ofCell = withPlop(tabsOf, held.id, first)
      } else if (held && own) ofCell = withMoved(tabsOf, held.id, held.landing)
      const shown = own && !plop ? withLanding(frame, held?.landing ?? null) : panesOf
      return [{ key, laid: lay(shown, place, { tabsOf: ofCell, shapeOf }) }]
    }),
  )

  /** Every cell's windows, lines and rooms on the one canvas. */
  const laid = $derived({
    slots: laidCells.flatMap((one) => one.laid.slots),
    seams: laidCells.flatMap((one) => one.laid.seams),
    rooms: laidCells.flatMap((one) => one.laid.rooms),
  })

  /** Which cell each window lies in, by tab. */
  const cellOf = $derived(
    new Map(laidCells.flatMap((one) => one.laid.slots.map((slot) => [slot.id, one.key] as const))),
  )

  /** Each cell's windows, boxed, for the membranes and for which cell a window is over. */
  const cellBoxes = $derived<Cell[]>(
    laidCells.map((one) => ({
      key: one.key,
      box: around(one.laid.slots) ?? places.at(one.key) ?? room,
    })),
  )

  const cellsShown = $derived(
    all
      ? cellBoxes.map((one) => ({
          ...one,
          name: workspace.spaces.find((space) => space.id === one.key)?.name ?? '',
          tint: workspace.tintFor(one.key),
          on: one.key === spaceKey,
        }))
      : [],
  )

  const byId = $derived(new Map(workspace.tabs.map((tab) => [tab.id, tab])))
  const windows = $derived(
    laid.slots.flatMap((slot) => {
      const tab = byId.get(slot.id)
      return tab ? [{ slot, tab }] : []
    }),
  )

  /** The size a pane's tab is drawn at inside its window: the pane's own. */
  function faceOf(slot: Slot) {
    const pane = panes[slot.paneId]
    if (pane && pane.w > 0) return { w: pane.w, h: pane.w * (slot.h / slot.w) }
    return { w: slot.w * 3, h: slot.h * 3 }
  }

  /** How far from its place, in pixels all told, a window's name starts to show. */
  const CAPTION_NEAR = 60

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const flights = new Map<string, Flight>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const elements = new Map<string, { window: HTMLElement; face: HTMLElement; chip: HTMLElement }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const captions = new Map<string, HTMLElement>()

  /** Where a window goes home to: its pane, for the tab the pane shows, else its tab in
   *  the strip. A tab with no place on screen - scrolled out of its strip - fades where
   *  it is. */
  function homeOf(tab: Tab, slot: Slot): Pose {
    if (workspace.panes.at(tab.paneId)?.activeTabId === tab.id) {
      const box = shownBox(tab.paneId)
      if (box && box.width > 0) return onCanvas(box, 0)
    }
    // The tab's own shape in the strip; see Tabs.svelte.
    const chip = marked('box', tab.id)?.getBoundingClientRect()
    if (chip && chip.width > 0 && chip.right > 0 && chip.left < width) return onCanvas(chip, 1)
    return { ...lifted(slot), alpha: 0 }
  }

  /** Where a box of the screen is on the canvas, as a pose `tab` much a tab. */
  function onCanvas(box: DOMRect, tab: number): Pose {
    const { x, y, w, h } = boxToCanvas(camera, { x: box.x, y: box.y, w: box.width, h: box.height })
    return { x, y, w, h, tab, alpha: 1 }
  }

  /** A slot as the pose of a window lying in it. */
  const lying = (slot: Slot): Pose => ({
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    tab: 0,
    alpha: 1,
  })

  /** A little smaller than its slot, where a window arrives from nowhere. */
  function lifted(slot: Slot): Pose {
    const less = 0.9
    return {
      x: slot.x + (slot.w * (1 - less)) / 2,
      y: slot.y + (slot.h * (1 - less)) / 2,
      w: slot.w * less,
      h: slot.h * less,
      tab: 0,
      alpha: 0,
    }
  }

  /** The keyboard's window, by tab. */
  let at = $state<string | null>(null)

  let frameAsked = 0
  let last = 0

  function fly() {
    if (frameAsked) return
    last = performance.now()
    frameAsked = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    frameAsked = 0
    const seconds = Math.max(0, (now - last) / 1000)
    last = now
    let moving = false
    for (const [id, flight] of flights) {
      if (!flight.step(seconds)) moving = true
      if (id === held?.id) follow()
      else paint(id)
    }
    if (moving) fly()
    else if (!out) gone()
  }

  /** Writes a window's pose onto its element. */
  function paint(id: string) {
    const flight = flights.get(id)
    const parts = elements.get(id)
    const slot = laid.slots.find((one) => one.id === id)
    if (!flight || !parts || !slot) return
    const pose = flight.pose
    const styles = drawn(pose, slot.w, slot.h, corner)
    Object.assign(parts.window.style, styles.window)
    Object.assign(parts.face.style, styles.face)
    Object.assign(parts.chip.style, styles.chip)
    // The name under a window only once it is nearly in its place.
    const caption = captions.get(id)
    if (caption) {
      const off =
        Math.abs(pose.x - slot.x) +
        Math.abs(pose.y - slot.y) +
        Math.abs(pose.w - slot.w) +
        Math.abs(pose.h - slot.h)
      const near = Math.max(0, 1 - off / CAPTION_NEAR)
      caption.style.opacity = String(near * Math.max(0, 1 - pose.tab * 3) * pose.alpha)
    }
  }

  /** Sends every window where it goes: onto the canvas, or home. */
  function aimAll() {
    const hand = untrack(() => held?.id)
    for (const { slot, tab } of untrack(() => windows)) {
      if (tab.id === hand) continue
      const flight = flights.get(tab.id)
      flight?.aim(out ? lying(slot) : homeOf(tab, slot))
    }
    if (stillness()) {
      for (const [id, flight] of flights) {
        flight.land()
        paint(id)
      }
      if (!out) gone()
      return
    }
    fly()
  }

  /** A window's corner: the card's, read as the layer comes up (#1088). */
  let corner = 0

  function cardCorner(): number {
    return (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-radius')) || 0
    )
  }

  /** The layer comes up: every pane measured and copied while it is still itself, the
   *  windows put where their tabs are, and sent out. */
  function enter() {
    const again = shown
    if (!again) {
      corner = cardCorner()
      lookAtSpace()
      measure()
      const copies: Record<string, HTMLElement> = {}
      for (const pane of workspace.panes.all) {
        const tab = pane.activeTabId ? byId.get(pane.activeTabId) : undefined
        // A page is its photograph: the copy of a pane holding a live webview is a hole.
        if (tab && tab.kind !== 'web') {
          const copy = mirrorOf(pane.id)
          if (copy) copies[tab.id] = copy
        }
        if (tab?.kind === 'web') void pages.shoot(tab.id)
      }
      mirrors = copies
      at = workspace.activeTabId
    }
    shown = true
    out = true
    tabOverview.out = workspace.tabs.map((tab) => tab.id)
    if (again) aimAll()
  }

  /** What each pane shows, measured: its windows take that shape. */
  function measure() {
    const measured: Record<string, { w: number; h: number }> = {}
    for (const pane of workspace.panes.all) {
      const box = shownBox(pane.id)
      if (box) measured[pane.id] = { w: box.width, h: box.height }
    }
    panes = measured
  }

  /** Another space, picked while the view is up: the camera goes to its place. */
  $effect(() => arrivedIn(spaceKey))

  function arrivedIn(space: string) {
    if (space && untrack(() => shown && out)) untrack(lookAtSpace)
  }

  /** Every window home. */
  function leave() {
    held = null
    pressed = null
    out = false
    aimAll()
  }

  /** The last window is home: the layer goes and the strip has its tabs back. */
  function gone() {
    shown = false
    flights.clear()
    mirrors = {}
    tabOverview.out = []
  }

  const close = () => (tabOverview.open = false)

  $effect(() => {
    if (tabOverview.open) untrack(enter)
    else if (untrack(() => shown)) untrack(leave)
  })

  $effect(() => (shown && tabOverview.open ? overlays.show(close) : undefined))
  $effect(() => closeOnBack(shown && tabOverview.open, close))

  /** A window gets its flight the first time it is drawn: from its home on the way out,
   *  from nowhere for one that arrived while the layer was up. */
  function placed(node: HTMLElement, id: string) {
    const face = node.querySelector<HTMLElement>(':scope > .face-box')
    const chip = node.querySelector<HTMLElement>(':scope > .chip')
    if (!face || !chip) return
    elements.set(id, { window: node, face, chip })
    const entry = windows.find((one) => one.tab.id === id)
    if (entry && !flights.has(id)) {
      flights.set(id, new Flight(out ? homeOf(entry.tab, entry.slot) : lying(entry.slot)))
    }
    paint(id)
    aimAll()
    if (id === at) node.focus({ preventScroll: true })
    return {
      destroy() {
        elements.delete(id)
        flights.delete(id)
      },
    }
  }

  function captioned(node: HTMLElement, id: string) {
    captions.set(id, node)
    return {
      destroy() {
        captions.delete(id)
      },
    }
  }

  /** The layout changed under the windows - a resize, a space switched - so each goes to
   *  its new place from where it is. */
  $effect(() => relaid(laid))

  function relaid(now: Laid) {
    if (now.slots.length && untrack(() => shown)) untrack(aimAll)
  }

  /** A press on a window: the tab comes forward and its window grows back into the
   *  pane, while the others go home. */
  function open(tab: Tab) {
    workspace.activate(tab.id)
    // A tab of another space brings its space forward first, which takes a moment; the
    // windows go home once its panes are the window's.
    if (workspace.panes.at(tab.paneId)) close()
    else void cameForward(tab).then(close)
  }

  async function cameForward(tab: Tab) {
    for (let wait = 0; wait < 60 && !workspace.panes.at(tab.paneId); wait++) {
      await new Promise((go) => requestAnimationFrame(go))
    }
  }

  /** Where the pointer went down on a window, until it is a drag or a press. */
  let pressed: { id: string; x: number; y: number; pointer: number } | null = null
  /** Whether the press that just ended was a drag, so its click opens nothing. */
  let dragged = false

  function down(event: PointerEvent, id: string) {
    if (event.button !== 0 || !out) return
    pressed = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId }
    dragged = false
    event.stopPropagation()
  }

  function moved(event: PointerEvent) {
    if (pressed?.pointer !== event.pointerId) return
    const id = pressed.id
    if (!held) {
      if (!isDrag(event.clientX - pressed.x, event.clientY - pressed.y)) return
      const flight = flights.get(id)
      if (!flight) return
      const pose = flight.pose
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
      const grabbed = toCanvas(camera, pressed)
      const tab = byId.get(id)
      held = {
        id,
        fx: (grabbed.x - pose.x) / Math.max(pose.w, 1),
        fy: (grabbed.y - pose.y) / Math.max(pose.h, 1),
        landing: null,
        from: cellOf.get(id) ?? spaceKey,
        // The spaces Move to space would offer it, which are the cells it may plop into.
        goes: tab
          ? spacesFor([movingOf(tab)], workspace, canWriteAt, mayCarry).map((one) => one.id)
          : [],
      }
      at = id
    }
    hand = toCanvas(camera, { x: event.clientX, y: event.clientY })
    const landing = landingFor(id, hand)
    if (JSON.stringify(landing) !== JSON.stringify(held.landing)) held = { ...held, landing }
    follow()
    fly()
  }

  /** Where the held window would land with the pointer at `point`: in another space's
   *  cell once it is well inside it, else in its own - in a strip or against a side, where
   *  its own is the space worked in, whose panes are the window's. */
  function landingFor(id: string, point: Point): Landing | null {
    if (!held) return null
    const from = held.from
    const goes = held.goes
    const now = held.landing?.kind === 'space' ? held.landing.key : from
    const cells = cellBoxes.filter((one) => one.key === from || goes.includes(one.key))
    const cell = all ? cellAt(cells, now, point.x, point.y) : from
    if (cell !== from) return { kind: 'space', key: cell }
    if (from !== spaceKey) return null
    return landingAt(without?.slots ?? [], without?.rooms ?? [], point.x, point.y, (paneId, side) =>
      workspace.canLand(side, paneId, id),
    )
  }

  /** The held window and the cell it is in now, for the membranes. */
  function pushedNow(): { key: string; box: Box } | null {
    if (!held) return null
    const pose = flights.get(held.id)?.pose
    if (!pose) return null
    const key = held.landing?.kind === 'space' ? held.landing.key : held.from
    return { key, box: { x: pose.x, y: pose.y, w: pose.w, h: pose.h } }
  }

  /** Where the pointer is, while a window is held. */
  let hand: Point = { x: 0, y: 0 }

  /** The held window under the pointer, the point it was taken by under the pointer
   *  exactly, growing or shrinking to the place it would land in. */
  function follow() {
    if (!held) return
    const flight = flights.get(held.id)
    const slot = laid.slots.find((one) => one.id === held?.id)
    if (!flight || !slot) return
    const { w, h } = flight.pose
    flight.hold(hand.x - held.fx * w, hand.y - held.fy * h, slot.w, slot.h)
    paint(held.id)
  }

  /** Let go: the tab moves where its window was let go, and the window settles there. */
  function up(event: PointerEvent) {
    if (pressed?.pointer !== event.pointerId) return
    pressed = null
    const hand = held
    if (!hand) return
    dragged = true
    held = null
    if (hand.landing) drop(hand.id, hand.landing)
    aimAll()
  }

  function cancelled() {
    pressed = null
    held = null
    aimAll()
  }

  /** The tab moved along its strip or into another pane's, before the tab it landed in
   *  front of. */
  function drop(id: string, landing: Landing) {
    if (landing.kind === 'space') {
      // Move to space, the tab menu's own: the tab, its file where it has one, into the
      // other space's set (workspace/moving-space.ts).
      void import('../workspace/moving-space').then((one) => one.moveToSpace([id], landing.key))
      return
    }
    if (landing.kind === 'side') {
      workspace.dropTab(id, { kind: 'pane', paneId: landing.paneId, zone: landing.side })
      // The panes have new shapes once the split is laid out.
      requestAnimationFrame(measure)
      return
    }
    const strip = tabsOf(landing.paneId)
    const back = strip.filter((one) => one !== id)
    const into = landing.before === null ? back.length : back.indexOf(landing.before)
    // Let go where it was: nothing moved.
    if (strip.indexOf(id) === into && byId.get(id)?.paneId === landing.paneId) return

    // Counted the way the workspace counts a strip: every tab of the pane but this one,
    // its Essentials too.
    const held = workspace.heldIn(landing.paneId).filter((one) => one.id !== id)
    const before = landing.before === null ? -1 : held.findIndex((one) => one.id === landing.before)
    workspace.moveTab(id, landing.paneId, before < 0 ? held.length : before)
  }

  function keyed(event: KeyboardEvent) {
    const way = wayOf(event.key)
    if (!way || chorded(event)) return
    const from = windows.findIndex((one) => one.tab.id === at)
    const next =
      windows[
        walk(
          windows.map((one) => one.slot),
          Math.max(from, 0),
          way,
        )
      ]
    if (!next) return
    event.preventDefault()
    at = next.tab.id
    camera = showing(camera, next.slot, screenRoom)
    elements.get(next.tab.id)?.window.focus({ preventScroll: true })
  }

  const spaces = $derived(workspace.shownSpaces)

  /** The wheel and two fingers on a touchpad move the canvas, a pinch brings it nearer.
   *  Listened for by hand, since a passive listener cannot keep the page from zooming. */
  function wheeled(node: HTMLElement) {
    const turn = (event: WheelEvent) => {
      event.preventDefault()
      const { deltaX, deltaY, deltaMode, ctrlKey, metaKey, clientX, clientY } = event
      camera = turned(camera, {
        deltaX,
        deltaY,
        deltaMode,
        ctrlKey,
        metaKey,
        x: clientX,
        y: clientY,
      })
    }
    node.addEventListener('wheel', turn, { passive: false })
    return {
      destroy() {
        node.removeEventListener('wheel', turn)
      },
    }
  }

  /** The fingers or the mouse on the canvas itself, between the windows: one moves it,
   *  two pinch it, and a press that moved neither puts the view away. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read by the handlers, never rendered
  const touching = new Map<number, Point>()
  let panning = false

  function grounded(event: PointerEvent) {
    if (!(event.target instanceof Element) || event.target.closest('.window, .spaces')) return
    touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    panning = touching.size > 1
  }

  function dragging(event: PointerEvent) {
    const was = touching.get(event.pointerId)
    if (!was) return
    const now = { x: event.clientX, y: event.clientY }
    const [first, second] = [...touching.entries()]
    if (touching.size === 2 && first && second) {
      const before: [Point, Point] = [first[1], second[1]]
      touching.set(event.pointerId, now)
      const after: [Point, Point] = [
        touching.get(first[0]) ?? first[1],
        touching.get(second[0]) ?? second[1],
      ]
      camera = pinched(camera, before, after)
      return
    }
    if (!panning && !isDrag(now.x - was.x, now.y - was.y)) return
    panning = true
    camera = panned(camera, now.x - was.x, now.y - was.y)
    touching.set(event.pointerId, now)
  }

  function letGo(event: PointerEvent) {
    if (!touching.delete(event.pointerId)) return
    if (!touching.size && !panning && event.type === 'pointerup') close()
    if (!touching.size) panning = false
  }
</script>

<svelte:window
  onresize={() => {
    width = window.innerWidth
    height = window.innerHeight
  }}
/>

{#if shown}
  <div class="nib-scrim ground" class:is-out={out} aria-hidden="true"></div>

  <div
    class="canvas"
    role="dialog"
    aria-modal="true"
    aria-label={t('Tabs')}
    tabindex="-1"
    use:trap
    use:wheeled
    onkeydown={keyed}
    onpointerdown={grounded}
    onpointermove={dragging}
    onpointerup={letGo}
    onpointercancel={letGo}
  >
    {#if spaces.length > 1}
      <div class="spaces" class:is-out={out} role="group" aria-label={t('Spaces')}>
        <!-- Current space or All spaces: whether the other spaces' cells are there too. -->
        <div class="which" role="radiogroup" aria-label={t('Spaces')}>
          <button
            class="space"
            class:is-on={!all}
            role="radio"
            aria-checked={!all}
            onclick={() => showAll(false)}>{t('This space')}</button
          >
          <button
            class="space"
            class:is-on={all}
            role="radio"
            aria-checked={all}
            onclick={() => showAll(true)}>{t('All spaces')}</button
          >
        </div>
        {#each spaces as space (space.id)}
          <button
            class="space"
            class:is-on={space.id === workspace.activeSpaceId}
            aria-pressed={space.id === workspace.activeSpaceId}
            onclick={() => void workspace.selectSpace(space.id)}
          >
            <SpaceBadge {space} on={space.id === workspace.activeSpaceId} />
            <span class="space-name">{space.name}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="world" style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})">
      {#if cellsShown.length}
        <Cells cells={cellsShown} pushed={pushedNow} holding={held !== null} />
      {/if}
      <svg class="seams" class:is-out={out} width="1" height="1" aria-hidden="true">
        {#each laid.seams as seam (seam.id)}
          <path d={seamPath(seam)} />
        {/each}
      </svg>

      {#each windows as { slot, tab } (tab.id)}
        {@const face = faceOf(slot)}
        <button
          class="window"
          class:is-at={at === tab.id}
          class:unsaved={isUnsaved(tab.note)}
          style:width="{slot.w}px"
          style:height="{slot.h}px"
          aria-label={tab.shown}
          aria-current={tab.id === workspace.activeTabId ? 'page' : undefined}
          class:is-held={held?.id === tab.id}
          onfocus={() => (at = tab.id)}
          onclick={() => {
            if (dragged) dragged = false
            else open(tab)
          }}
          onpointerdown={(event) => down(event, tab.id)}
          onpointermove={moved}
          onpointerup={up}
          onpointercancel={cancelled}
          use:placed={tab.id}
        >
          <span class="face-box" style:scale={slot.w / face.w}>
            <WindowFace {tab} mirror={mirrors[tab.id] ?? null} width={face.w} height={face.h} />
          </span>
          <span class="chip" aria-hidden="true">
            <span class="chip-inner"
              ><TabMark {tab} /><span class="chip-name">{tab.shown}</span></span
            >
          </span>
          <span class="ring" aria-hidden="true"></span>
        </button>
        <span
          class="caption"
          style:translate="{slot.x}px {slot.y + slot.h + 8}px"
          style:width="{slot.w}px"
          aria-hidden="true"
          use:captioned={tab.id}
        >
          <TabMark {tab} /><span class="caption-name">{tab.shown}</span>
        </span>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* The canvas: the app behind it, blurred far enough to be a surface and not a page. */
  .ground {
    --scrim-z: var(--z-sheet);
    --scrim-blur: 28px;
    --scrim-ink: 55%;
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
  }

  .ground.is-out {
    opacity: 1;
  }

  .canvas {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    overflow: hidden;
    outline: none;
    touch-action: none;
  }

  .spaces {
    position: absolute;
    top: var(--space-6);
    left: 50%;
    display: flex;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-6));
    overflow-x: auto;
    translate: -50% -8px;
    opacity: 0;
    transition:
      opacity var(--dur-base) var(--ease-out),
      translate var(--dur-base) var(--ease-out);
  }

  .spaces.is-out {
    translate: -50% 0;
    opacity: 1;
  }

  /* The switch between the two, a pill of two halves before the spaces. */
  .which {
    display: flex;
    flex: none;
    gap: 2px;
    margin-inline-end: var(--space-4);
  }

  .space {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: var(--row-height);
    padding: 0 var(--space-3) 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: calc(var(--row-height) / 2);
    color: var(--muted);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
  }

  .space:hover {
    color: var(--text);
  }

  .space.is-on {
    color: var(--text-strong);
    border-color: var(--line);
    background: var(--surface);
  }

  /* The one canvas, which the camera moves and scales; see camera.ts. */
  .world {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  .seams {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .seams.is-out {
    opacity: 1;
    transition-delay: var(--dur-base);
  }

  .seams path {
    fill: none;
    stroke: color-mix(in srgb, var(--accent) 55%, var(--muted));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: none;
  }

  /* A window: no frame, floating. Laid out once at its slot's size at the canvas's
     corner; flight.ts moves and scales it from there. */
  .window {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: start;
    overflow: hidden;
    transform-origin: 0 0;
    background: var(--bg);
    box-shadow: var(--shadow-lg);
    will-change: transform;
    cursor: pointer;
    outline: none;
    touch-action: none;
  }

  /* Under the hand, over the others, a little higher off the canvas. */
  .window.is-held {
    z-index: var(--z-raised);
    box-shadow:
      var(--shadow-lg),
      0 32px 80px -16px rgb(0 0 0 / 0.35);
    cursor: grabbing;
  }

  .face-box {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }

  /* The tab it was, at the tab's own size whatever the window's scale. */
  .chip {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    transform-origin: 0 0;
    background: var(--tab-active, var(--surface));
    pointer-events: none;
  }

  .chip-inner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0 var(--space-3);
    color: var(--text);
    white-space: nowrap;
  }

  .chip-name,
  .caption-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A hairline round a window whose tab is somewhere in the file list, a dashed one round
     one that is nowhere yet; the accent round the keyboard's. */
  .ring {
    position: absolute;
    inset: 0;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    border-radius: inherit;
    pointer-events: none;
  }

  .window.unsaved .ring {
    border: 1.5px dashed color-mix(in srgb, var(--muted) 75%, transparent);
  }

  .window:hover .ring {
    border-color: var(--line-strong);
  }

  .window.is-at:focus-visible .ring {
    border: 2px solid var(--accent);
  }

  .caption {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--text);
    font-size: var(--text-sm);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
  }
</style>
