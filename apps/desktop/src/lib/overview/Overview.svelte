<script lang="ts">
  /** Every tab as a window on a canvas, Alt Alt (issue #331).
   *
   *  Not a layer over the app: a state of the window. Its bar stays, its sidebars slide
   *  away, and the room the tabs are shown in becomes the canvas, on the ground the panes
   *  always stood on. The tabs become the windows: each pane itself shrinks, where it is,
   *  into the window of its tab in front (`paneDrawn` in flight.ts) - the pane and not a
   *  copy of it - and the other tabs come down out of the strip from where each tab sits
   *  as pictures of themselves (WindowFace.svelte). They land laid out the way the panes
   *  are, a split's sides side by side with a curve between them (layout.ts). A web page,
   *  which no style can move, steps behind its picture for the whole run, and its pane
   *  stands back while the picture flies as its window. While a window is away, the tab
   *  it is is out of its strip, so nothing is seen twice. A press on one opens it: it
   *  grows back into its pane while the rest go home to the strip. Alt Alt again, Escape,
   *  or a press on the canvas send every window home.
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
   *  bubble that is its windows (Cells.svelte); a window dragged out of its cell takes the
   *  bubble with it, and pointed into another's plops across, which moves its tab to
   *  that space when it is let go (cells.ts). */

  import { tick as laidOut, untrack } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { t } from '../i18n.svelte'
  import { chorded } from '../keys'
  import { stillness } from '../motion'
  import { overlays } from '../overlays'
  import Cross from '../Cross.svelte'
  import Select from '../Select.svelte'
  import { tabOverview } from '../surfaces.svelte'
  import TabMark from '../TabMark.svelte'
  import { trap } from '../trap'
  import { pages } from '../web-tab/pages.svelte'
  import { isUnsaved } from '../workspace/drafts'
  import { type Tab, workspace } from '../workspace.svelte'
  import {
    boxToCanvas,
    type Camera,
    eased,
    isNotch,
    lookingAt,
    notched,
    pinched,
    type Point,
    showing,
    toCanvas,
    turned,
    moved as panned,
  } from './camera'
  import { isDrag, type Landing } from './drag'
  import { places } from './places.svelte'
  import { type Cell, cellAt } from './cells'
  import Cells from './Cells.svelte'
  import { grownOf } from './bubble'
  import { modes } from '../modes.svelte'
  import { keep, storedText } from '../stored'
  import { canWriteAt } from '../sharing.svelte'
  import { mayCarry } from '../workspace/chat-carry'
  import type { Frame } from '../workspace/pane-tree'
  import { movingOf, spacesFor } from '../workspace/space-move'
  import { faces } from './faces.svelte'
  import { drawn, Flight, paneDrawn, type Pose } from './flight'
  import { land as landSpring, resting as sprung, SHARE, spring, step } from './spring'
  import { roomFor, settled, stripLanding } from './free'
  import { around, type Box, type Laid, lay, seamPath, seamsAmong, type Slot } from './layout'
  import { marked, shownBox, tabCopyOf } from './mirror'
  import { walk, wayOf } from './walk'
  import WindowFace from './WindowFace.svelte'

  /** Whether the layer is on screen at all: from the first frame out until the last
   *  window is home. */
  let shown = $state(false)
  /** Whether the windows are out on the canvas, or on their way home. */
  let out = $state(false)

  let width = $state(window.innerWidth)
  let height = $state(window.innerHeight)

  /** The room the windows are laid out in: the window under its bar, less a margin and
   *  the row at the top. */
  const MARGIN = 56
  const ROW = 50

  /** Where the window's bar ends, which the overview leaves where it is: the canvas is
   *  everything under it (Titlebar.svelte's `header`). Read as the layer comes up. */
  let barBottom = $state(0)

  function barOf(): number {
    const bar = document.querySelector('header[data-chrome="top"]')?.getBoundingClientRect()
    return bar && bar.height > 0 ? Math.max(0, bar.bottom) : 0
  }

  const roomTop = $derived(barBottom + ROW)

  /** What each pane showed as the layer came up, which its windows take the shape of. */
  let panes = $state<Record<string, { w: number; h: number }>>({})
  /** The panes that are their own windows, by their tab in front: each pane's element,
   *  where it was laid out as the layer came up - the box it is moved from, and goes home
   *  to, however it is drawn meanwhile - and how tall its strip is. Every pane but one
   *  showing a web page, whose live view no style moves. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written as the layer comes up, read once a frame
  const panesAsWindows = new Map<string, { node: HTMLElement; box: DOMRect; head: number }>()
  /** And which tabs those are, for what their windows draw: nothing but a ring, the pane
   *  being under it. */
  let asPanes = $state<Record<string, true>>({})
  /** The copy of each tab as its strip draws it, by tab (mirror.ts `tabCopyOf`). */
  let tabsAsDrawn = $state<Record<string, HTMLElement>>({})

  const frame = $derived(workspace.panes.frame)
  /** The room the windows are laid out in on the screen, at one to one. */
  const screenRoom = $derived<Box>({
    x: MARGIN,
    y: roomTop,
    w: Math.max(width - 2 * MARGIN, 200),
    h: Math.max(height - roomTop - MARGIN, 160),
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
    // Then all of its cell, bubble, name and all, where it is drawn as one, never
    // nearer than one to one.
    const cell = cellBoxes.find((one) => one.key === spaceKey)
    if (!all || !cell) return
    camera = lookingAt(wholeOf([cell]), screenRoom)
  }

  /** Where some cells are drawn, their bubbles and names and all. */
  function wholeOf(cells: readonly Cell[]): Box {
    const named = NAME_ROOM * Math.max(1, 1 / camera.zoom)
    const boxes = cells.map(({ box }) => {
      const grown = grownOf(box)
      return { ...grown, y: grown.y - named, h: grown.h + named }
    })
    return around(boxes) ?? room
  }

  /** Tidy up: every window of every space back where its panes put it, the spaces in a
   *  row again, and the camera brought round to all of them (places.svelte.ts). */
  async function tidy() {
    places.tidy()
    for (const key of shownKeys) places.place(key, { w: screenRoom.w, h: screenRoom.h })
    await laidOut()
    flyTo(lookingAt(wholeOf(cellBoxes), screenRoom))
  }

  /** Where the camera is flying to, as Tidy up moves it: a share of the way each frame,
   *  the zoom in its own scale; a hand on the canvas takes over at once. */
  let flyGoal: Camera | null = null
  let flyFrame = 0
  let flyLast = 0

  function flyTo(goal: Camera) {
    if (stillness()) {
      camera = goal
      return
    }
    flyGoal = goal
    if (flyFrame) return
    flyLast = performance.now()
    flyFrame = requestAnimationFrame(flying)
  }

  function flying(now: number) {
    const goal = flyGoal
    if (!goal) return (flyFrame = 0)
    const share = 1 - Math.exp(-Math.min(1 / 30, Math.max(0, (now - flyLast) / 1000)) / 0.12)
    flyLast = now
    const zoom = camera.zoom * Math.exp(Math.log(goal.zoom / camera.zoom) * share)
    const near = Math.abs(goal.x - camera.x) + Math.abs(goal.y - camera.y) < 0.5
    camera =
      near && Math.abs(Math.log(goal.zoom / camera.zoom)) < 0.003
        ? goal
        : {
            x: camera.x + (goal.x - camera.x) * share,
            y: camera.y + (goal.y - camera.y) * share,
            zoom,
          }
    if (camera === goal) {
      flyGoal = null
      flyFrame = 0
    } else flyFrame = requestAnimationFrame(flying)
  }

  /** A hand on the canvas: whatever the camera was flying to, it is the hand's now. */
  function handTakes() {
    flyGoal = null
    cancelAnimationFrame(flyFrame)
    flyFrame = 0
  }

  /** The room a cell's name takes over its bubble. */
  const NAME_ROOM = 48

  const shapeOf = (paneId: string): number => {
    const measured = shownBox(paneId)
    const box = panes[paneId] ?? (measured && { w: measured.width, h: measured.height })
    return box && box.w > 0 && box.h > 0 ? box.w / box.h : 16 / 10
  }

  const tabsOf = (paneId: string) => workspace.tabsIn(paneId).map((tab) => tab.id)

  /** All spaces or This space: whether the other spaces' cells are shown as well. The
   *  same view either way. All spaces unless This space was picked, remembered on this
   *  device (Emil, 2026-11-04: All spaces is the default). */
  const ALL = 'nib:overview-spaces'
  let all = $state(storedText(ALL) !== 'this')

  function showAll(on: boolean) {
    all = on
    keep(ALL, on ? 'all' : 'this')
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
   *  width and height), where it lies now, and whether it is over another space's cell. */
  let held = $state<{
    id: string
    fx: number
    fy: number
    /** Where it lies under the hand, on the canvas; null until the hand has moved. */
    box: Box | null
    landing: (Landing & { kind: 'space' }) | null
    /** The space whose cell it was taken out of, and those it may go to. */
    from: string
    goes: readonly string[]
  } | null>(null)

  /** Each cell's windows where its panes would put them (layout.ts), with its panes,
   *  which the lines between a split's sides are drawn from. */
  const gridCells = $derived(
    shownKeys.flatMap((key) => {
      const own = key === spaceKey
      const panesOf = own ? frame : sets?.frameOf(key)
      if (!panesOf) return []
      const place = own ? room : (places.at(key) ?? room)
      return [
        {
          key,
          frame: panesOf,
          slots: lay(panesOf, place, { tabsOf, shapeOf, named: namedRoom }).slots,
        },
      ]
    }),
  )

  /** Every window where it lies, with nothing held: where it was put by hand, or else
   *  where its panes would put it, out of the way of the ones put by hand (free.ts). */
  const resting = $derived.by(() => {
    const put = places.windows
    const all = gridCells.flatMap((one) => one.slots)
    const lying = all.map((slot) => {
      const box = put[slot.id]
      return box ? { ...slot, x: box.x, y: box.y, w: box.w, h: box.h } : slot
    })
    return settled(lying, new Set(all.filter((one) => put[one.id]).map((one) => one.id)), namedRoom)
  })

  /** Which cell each window lies in, by tab: its space's, or the one the held window is
   *  over. */
  const cellOf = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- made afresh by the derived, never changed after
    const map = new Map(
      gridCells.flatMap((one) => one.slots.map((slot) => [slot.id, one.key] as const)),
    )
    if (held?.landing?.kind === 'space') map.set(held.id, held.landing.key)
    return map
  })

  /** And with one held: that one under the hand, where it stays when it is let go, and
   *  every other of the cell it is in pushed out of its way - back where it was once the
   *  hand moves on. Another cell's windows stay put, which the hand points into (free.ts
   *  `roomFor`). */
  const slots = $derived.by((): Slot[] => {
    const hand = held?.box
    const id = held?.id
    if (!hand || !id) return resting
    const key = cellOf.get(id)
    return roomFor(resting, id, hand, (one) => cellOf.get(one) === key, namedRoom)
  })

  /** Every window, and the lines between each split's sides. */
  const laid = $derived({
    slots,
    seams: gridCells.flatMap((one) =>
      seamsAmong(
        one.frame,
        slots.filter((slot) => cellOf.get(slot.id) === one.key && slot.id !== held?.id),
      ),
    ),
  })

  /** Each cell's windows, boxed, for which cell a window is over and for the camera: as
   *  they lie at rest, not as the held one pushes them, so where a cell is pointed into
   *  never moves under the hand; the held one left out, which never decides where the
   *  cell it is leaving is. */
  const cellBoxes = $derived<Cell[]>(
    gridCells.map((one) => {
      const inside = resting.filter(
        (slot) => cellOf.get(slot.id) === one.key && slot.id !== held?.id,
      )
      // A cell whose one window is held is where that window was taken from.
      const from = resting.filter(
        (slot) => slot.id === held?.id && one.slots.some((own) => own.id === slot.id),
      )
      return {
        key: one.key,
        box: captioned(around(inside) ?? around(from) ?? places.at(one.key) ?? room),
      }
    }),
  )

  const cellsShown = $derived(
    all
      ? cellBoxes.map((one) => ({
          key: one.key,
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

  /** How much room a window's name takes under it on the screen, at most. */
  const CAPTION_ROOM = 36

  /** The room the windows are laid out with under each for its name, on the canvas: as
   *  much as the name takes at the zoom the camera came to rest at, so no window lies on
   *  another's name. Followed once a zoom has stopped, not on every step of it, so the
   *  windows make room once rather than shuffling under the fingers (free.ts). */
  let namedZoom = $state(1)
  const namedRoom = $derived(CAPTION_ROOM * Math.max(1, 1 / namedZoom) + 12)
  let namedLater: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const zoom = camera.zoom
    clearTimeout(namedLater)
    if (zoom !== untrack(() => namedZoom)) namedLater = setTimeout(() => (namedZoom = zoom), 250)
    return () => clearTimeout(namedLater)
  })

  /** A window's box with its name under it, which its cell holds as well. */
  function captioned(box: Box): Box {
    return { ...box, h: box.h + CAPTION_ROOM * Math.max(1, 1 / camera.zoom) }
  }

  /** How far from its place, in pixels all told, a window's name starts to show. */
  const CAPTION_NEAR = 60

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const flights = new Map<string, Flight>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const elements = new Map<string, { window: HTMLElement; face: HTMLElement; chip: HTMLElement }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const captions = new Map<string, HTMLElement>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const closers = new Map<string, HTMLElement>()
  /** The windows that have come to rest on the canvas since it came up, which are where
   *  they are drawn from then on; one still on its way out of the strip is where it is
   *  going, as far as its cell is concerned. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once a frame, never rendered
  const arrived = new Set<string>()

  /** A cell's windows, each where it is drawn this frame - or, on its way out of the strip
   *  or home to it, where it lies on the canvas - for the bubble round them, which
   *  never leaves one out (bubble.ts). The window under the hand is `pushedNow`'s. */
  function insideOf(key: string): Box[] {
    const boxes: Box[] = []
    for (const slot of laid.slots) {
      if (slot.id === held?.id || cellOf.get(slot.id) !== key) continue
      const pose = arrived.has(slot.id) ? flights.get(slot.id)?.pose : null
      boxes.push(captioned(pose ? { x: pose.x, y: pose.y, w: pose.w, h: pose.h } : slot))
    }
    return boxes
  }

  /** Where a window goes home to: its pane, for the tab the pane shows, else its tab in
   *  the strip. A tab with no place on screen - scrolled out of its strip - fades where
   *  it is. */
  function homeOf(tab: Tab, slot: Slot): Pose {
    if (workspace.panes.at(tab.paneId)?.activeTabId === tab.id) {
      // A pane moving as its window is where it was laid out, not where it is drawn.
      const laidOut = panesAsWindows.get(tab.id)
      const box = laidOut
        ? new DOMRect(
            laidOut.box.x,
            laidOut.box.y + laidOut.head,
            laidOut.box.width,
            laidOut.box.height - laidOut.head,
          )
        : shownBox(tab.paneId)
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
    // The first frame that moves anything is the first the overview is seen in: until
    // then the app is what is on screen, unchanged (`started`).
    if (!started) begin()
    opening.to = out ? 1 : 0
    step(opening, seconds)
    opened(opening.at)
    let moving = !sprung(opening)
    for (const [id, flight] of flights) {
      if (!flight.step(seconds)) moving = true
      else if (out) arrived.add(id)
      if (id === held?.id) follow()
      else paint(id)
    }
    awayFromStrip()
    if (moving) fly()
    else if (!out) gone()
  }

  /** How far out the overview is, 0 the app as it was and 1 all the way: what the
   *  ground, the row at the top, the cells, the lines and the windows' shadows fade by,
   *  on a spring like the windows, so a change of mind turns it round where it is, and on
   *  the windows' clock, so the first frame and the last are the app's own. */
  const opening = spring(0, SHARE)
  let ground = $state<HTMLElement>()
  let canvasNode = $state<HTMLElement>()

  function opened(at: number) {
    const value = String(Math.round(at * 1000) / 1000)
    // The sidebars slide out as far as the overview is out (`html[data-overview]`).
    document.documentElement.style.setProperty('--overview-open', value)
    if (ground) {
      ground.style.opacity = value
      // Not there at all at the ends: a ground over the app, however faint, has the app
      // drawn through it, which is not quite how the app draws itself.
      ground.style.visibility = at < 0.01 ? 'hidden' : ''
    }
    canvasNode?.style.setProperty('--overview-open', value)
  }

  /** Whether a frame of the overview has been drawn since it was asked for. Before the
   *  first, every window lies exactly on what it was - its pane, its tab - and is not
   *  drawn, and the strip keeps its tabs: what is on screen is the app itself, never a
   *  copy of it that the eye could tell from it. The first frame takes the tabs out of
   *  the strip and shows the windows, already on their way. */
  let started = true

  /** Where each window came out from, or is going home to: its pane, or its tab in the
   *  strip. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once a frame, never rendered
  const homes = new Map<string, Pose>()

  /** How near its home a window is handed over: within this many pixels of it on the
   *  screen, all told, it gives way to the pane or the tab it is, which is under it in
   *  the same place - all the way at its home, only the app is drawn. A copy is drawn a
   *  hair differently from what it copies, the text above all, and a handover spread
   *  over the last frames of a movement is one the eye cannot find. */
  const NEAR = 14

  /** How far a window is from its home on the screen, or null for one with none. */
  function fromHome(id: string): number | null {
    const home = homes.get(id)
    const pose = flights.get(id)?.pose
    if (!home || !pose || home.alpha < 0.5) return null
    const off =
      Math.abs(pose.x - home.x) +
      Math.abs(pose.y - home.y) +
      Math.abs(pose.w - home.w) +
      Math.abs(pose.h - home.h)
    return off * camera.zoom
  }

  /** What a window is a copy of is out of sight while the window is away from it, so
   *  the two are never seen at once: the strip leaves out every tab whose window is away,
   *  the tab in front of a pane too - the bar is the window's own while the overview is
   *  up, and a strip still holding the tab whose window is on the canvas would be that
   *  tab twice - and a pane whose tab in front is a window away from the pane stands
   *  back; but for a window near its home, which is handed over to what is under it
   *  there. */
  function awayFromStrip() {
    if (!started) return
    const away: string[] = []
    const lifted: string[] = []
    for (const id of flights.keys()) {
      const home = homes.get(id)
      const off = out ? null : fromHome(id)
      const gone = off === null || off >= NEAR
      if (home && home.alpha > 0.5 && home.tab < 0.5) {
        const pane = byId.get(id)?.paneId
        if (gone && pane && !movesAsWindow(id)) lifted.push(pane)
      }
      if (gone) away.push(id)
    }
    if (away.join(' ') !== tabOverview.out.join(' ')) tabOverview.out = away
    if (lifted.join(' ') !== tabOverview.lifted.join(' ')) tabOverview.lifted = lifted
  }

  function begin() {
    started = true
    for (const id of flights.keys()) paint(id)
  }

  /** Writes a window's pose onto its element. */
  function paint(id: string) {
    const flight = flights.get(id)
    const parts = elements.get(id)
    const slot = laid.slots.find((one) => one.id === id)
    if (!flight || !parts || !slot) return
    const pose = flight.pose
    const styles = drawn(pose, slot.w, slot.h, corner, camera.zoom)
    // Out, the first frame that moves is already the window's: the movement hides the
    // change. Home, the movement is slowest at its very end, so it is handed over there.
    const home = started ? (out ? null : fromHome(id)) : 0
    if (home !== null && home < NEAR)
      styles.window.opacity = String(Number(styles.window.opacity) * (home / NEAR))
    Object.assign(parts.window.style, styles.window)
    Object.assign(parts.face.style, styles.face)
    Object.assign(parts.chip.style, styles.chip)
    if (started) movePane(id, pose)
    // The name under a window, and its cross, only once it is nearly in its place.
    const off =
      Math.abs(pose.x - slot.x) +
      Math.abs(pose.y - slot.y) +
      Math.abs(pose.w - slot.w) +
      Math.abs(pose.h - slot.h)
    const near = Math.max(0, 1 - off / CAPTION_NEAR) * Math.max(0, 1 - pose.tab * 3) * pose.alpha
    const caption = captions.get(id)
    if (caption) caption.style.opacity = String(near)
    closers.get(id)?.style.setProperty('--near', String(near))
  }

  /** Whether the pane of tab `id` is that tab's window: it was in front as the layer came
   *  up, and still is. */
  function movesAsWindow(id: string): boolean {
    const pane = byId.get(id)?.paneId
    return panesAsWindows.has(id) && !!pane && workspace.panes.at(pane)?.activeTabId === id
  }

  /** A pane drawn where its window is this frame: over the bubbles and the names, under
   *  the windows of the other tabs and its own ring, and over all of them while it is the
   *  one held. It takes no press; its window over it does. */
  function movePane(id: string, pose: Pose) {
    const one = panesAsWindows.get(id)
    if (!one) return
    if (!movesAsWindow(id)) return putBack(one.node)
    const styles = paneDrawn(pose, camera, one.box, one.head, corner, opening.at)
    Object.assign(one.node.style, styles, {
      transformOrigin: '0 0',
      zIndex: id === held?.id ? 'var(--z-sheet)' : 'var(--z-raised)',
      pointerEvents: 'none',
      // A layer of its own while it moves; at rest drawn again at the size it is shown,
      // so its words are as sharp as the other windows'.
      willChange: flights.get(id)?.resting && id !== held?.id ? 'auto' : 'transform',
    })
  }

  /** The camera moved - a pan, a pinch, a notch - and the panes moving as their windows
   *  with it, which no world they are in moves for them. */
  $effect(() => {
    const looking = { ...camera }
    untrack(() => {
      if (!shown || !started || looking.zoom <= 0) return
      for (const id of panesAsWindows.keys()) {
        const pose = flights.get(id)?.pose
        if (pose) movePane(id, pose)
      }
    })
  })

  const PANE_STYLES = [
    'transform',
    'transform-origin',
    'clip-path',
    'opacity',
    'z-index',
    'pointer-events',
    'will-change',
  ]

  /** A pane where it is laid out, drawn as it always is. */
  function putBack(node: HTMLElement) {
    for (const name of PANE_STYLES) node.style.removeProperty(name)
  }

  /** Sends every window where it goes: onto the canvas, or home. */
  function aimAll() {
    const hand = untrack(() => held?.id)
    for (const { slot, tab } of untrack(() => windows)) {
      if (tab.id === hand) continue
      const flight = flights.get(tab.id)
      if (out) flight?.aim(lying(slot))
      else {
        const home = homeOf(tab, slot)
        homes.set(tab.id, home)
        flight?.aim(home)
      }
    }
    if (stillness()) {
      if (!started) begin()
      opening.to = out ? 1 : 0
      landSpring(opening)
      opened(opening.at)
      for (const [id, flight] of flights) {
        flight.land()
        if (out) arrived.add(id)
        paint(id)
      }
      awayFromStrip()
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
      barBottom = barOf()
      places.recall(workspace.tabs)
      void faces.read()
      // Where it was left, once there is somewhere; the space worked in the first time.
      measure()
      lookAtSpace()
      camera = places.camera ?? camera
      namedZoom = camera.zoom
      panesAsWindows.clear()
      const asWindows: Record<string, true> = {}
      for (const pane of workspace.panes.all) {
        const tab = pane.activeTabId ? byId.get(pane.activeTabId) : undefined
        if (!tab) continue
        // A page is its photograph, its live view out of sight behind it: no style moves a
        // native view, and one that moved would be told every frame where it is.
        if (tab.kind === 'web') {
          void pages.shoot(tab.id)
          continue
        }
        const node = marked('pane', pane.id)
        const box = node?.getBoundingClientRect()
        if (!node || !box || box.width <= 0 || box.height <= 0) continue
        const head = node.querySelector(':scope > .head')?.getBoundingClientRect().height ?? 0
        panesAsWindows.set(tab.id, { node, box, head })
        asWindows[tab.id] = true
        // Kept, for the next time it is not in front: copied now, while it is drawn where
        // it is laid out (faces.svelte.ts).
        faces.take(pane.id, tab)
      }
      asPanes = asWindows
      // Each tab as its strip draws it, which its window leaves the strip as.
      const inherited = new Map<Element, string>()
      const tabCopies: Record<string, HTMLElement> = {}
      for (const tab of workspace.tabs) {
        const copy = tabCopyOf(tab.id, inherited)
        if (copy) tabCopies[tab.id] = copy
      }
      tabsAsDrawn = tabCopies
      at = workspace.activeTabId
      started = false
      homes.clear()
    }
    shown = true
    out = true
    document.documentElement.dataset.overview = modes.overviewBlur ? 'blur' : 'slide'
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
    // A notch still on its way is where it was going.
    if (zoomGoal) camera = eased(camera, zoomGoal.zoom, zoomGoal.at, Number.POSITIVE_INFINITY)
    zoomGoal = null
    cancelAnimationFrame(zoomFrame)
    zoomFrame = 0
    places.remember(camera)
    out = false
    arrived.clear()
    aimAll()
  }

  /** The last window is home: the layer goes and the strip has its tabs back. */
  function gone() {
    homes.clear()
    shown = false
    flights.clear()
    for (const { node } of panesAsWindows.values()) putBack(node)
    panesAsWindows.clear()
    asPanes = {}
    tabsAsDrawn = {}
    tabOverview.out = []
    tabOverview.lifted = []
    delete document.documentElement.dataset.overview
    document.documentElement.style.removeProperty('--overview-open')
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
      const home = out ? homeOf(entry.tab, entry.slot) : null
      if (home) homes.set(id, home)
      flights.set(id, new Flight(home ?? lying(entry.slot)))
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

  function named(node: HTMLElement, id: string) {
    captions.set(id, node)
    return {
      destroy() {
        captions.delete(id)
      },
    }
  }

  /** A tab's copy, put in its window's chip. */
  function holdingTab(node: HTMLElement, copy: HTMLElement | undefined) {
    if (copy) node.replaceChildren(copy)
  }

  function closing(node: HTMLElement, id: string) {
    closers.set(id, node)
    return {
      destroy() {
        closers.delete(id)
      },
    }
  }

  /** The cross on a window: its tab closed the way the strip's cross closes one, asking
   *  first where that asks - a note with words and no file, a terminal still running
   *  something (workspace.closeAsking). Its window goes with it. */
  function shut(event: MouseEvent, tab: Tab) {
    event.stopPropagation()
    void workspace.closeAsking(tab.id)
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
        box: null,
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
    // Its own size, the point it was taken by under the pointer.
    const own = resting.find((one) => one.id === id)
    const w = own?.w ?? 1
    const h = own?.h ?? 1
    const box = { x: hand.x - held.fx * w, y: hand.y - held.fy * h, w, h }
    held = { ...held, box, landing: landingFor(hand) }
    follow()
    fly()
  }

  /** Whether the held window, with the pointer at `point`, is over another space's cell:
   *  once the pointer is nearer that cell's windows than its own's (cells.ts). */
  function landingFor(point: Point): (Landing & { kind: 'space' }) | null {
    if (!held) return null
    const from = held.from
    const goes = held.goes
    const now = held.landing?.key ?? from
    const cells = cellBoxes.filter((one) => one.key === from || goes.includes(one.key))
    const cell = all ? cellAt(cells, now, point.x, point.y, camera.zoom) : from
    return cell === from ? null : { kind: 'space', key: cell }
  }

  /** The held window and the cell it is in now, for the bubbles. */
  function pushedNow(): { key: string; box: Box } | null {
    if (!held) return null
    const pose = flights.get(held.id)?.pose
    if (!pose) return null
    const key = held.landing?.key ?? held.from
    // Its name under it, which its bubble holds as well.
    return { key, box: captioned({ x: pose.x, y: pose.y, w: pose.w, h: pose.h }) }
  }

  /** Where the pointer is, while a window is held. */
  let hand: Point = { x: 0, y: 0 }

  /** The held window under the pointer, the point it was taken by under the pointer
   *  exactly. */
  function follow() {
    const box = held?.box
    const flight = held && flights.get(held.id)
    if (!box || !flight || !held) return
    flight.hold(box.x, box.y, box.w, box.h)
    paint(held.id)
  }

  /** Let go: the window stays exactly where it was let go, and every window keeps where
   *  it lies now, the ones it pushed aside too (places.svelte.ts). Over another space's
   *  cell, its tab moves to that space; in its own, the space worked in, it takes its
   *  place in the strip of the pane it was let go among, where it reads among that
   *  pane's windows (free.ts). */
  function up(event: PointerEvent) {
    if (pressed?.pointer !== event.pointerId) return
    pressed = null
    const hand = held
    if (!hand) return
    dragged = true
    const lying = laid.slots
    const box = hand.box
    held = null
    if (box) {
      places.keepWindows(Object.fromEntries(lying.map((one) => [one.id, one])), workspace.tabs)
    }
    if (hand.landing) drop(hand.id, hand.landing)
    else if (box && hand.from === spaceKey) {
      const own = lying.filter((one) => cellOf.get(one.id) === spaceKey)
      const strip = stripLanding(own, hand.id, box)
      if (strip) drop(hand.id, { kind: 'strip', ...strip })
    }
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

  /** Where a notch of the wheel is taking the zoom, and about which point of
   *  the screen; eased there a frame at a time (camera.ts). */
  let zoomGoal: { zoom: number; at: Point } | null = null
  let zoomFrame = 0
  let zoomLast = 0

  function zooming(now: number) {
    const goal = zoomGoal
    if (!goal) return (zoomFrame = 0)
    // A frame dropped is a frame's worth of the way, not a leap.
    camera = eased(
      camera,
      goal.zoom,
      goal.at,
      Math.min(1 / 30, Math.max(0, (now - zoomLast) / 1000)),
    )
    zoomLast = now
    if (camera.zoom === goal.zoom) {
      zoomGoal = null
      zoomFrame = 0
    } else zoomFrame = requestAnimationFrame(zooming)
  }

  /** Every scroll zooms, Ctrl held or not, and none moves the canvas, which only a drag
   *  on it does: a notch of the wheel eases nearer or further, as a page's zoom does,
   *  never in steps, and fingers on a touchpad, scrolling or pinching, are followed under
   *  the fingers. Listened for by hand, since a passive listener cannot keep the page
   *  from zooming. */
  function wheeled(node: HTMLElement) {
    const turn = (event: WheelEvent) => {
      event.preventDefault()
      const { deltaX, deltaY, deltaMode, ctrlKey, metaKey, clientX, clientY } = event
      const said = { deltaX, deltaY, deltaMode, ctrlKey, metaKey, x: clientX, y: clientY }
      handTakes()
      if (isNotch(said)) {
        const zoom = notched(zoomGoal?.zoom ?? camera.zoom, said)
        if (stillness()) {
          camera = eased(camera, zoom, said, Number.POSITIVE_INFINITY)
          return
        }
        zoomGoal = { zoom, at: { x: clientX, y: clientY } }
        if (!zoomFrame) {
          zoomLast = performance.now()
          zoomFrame = requestAnimationFrame(zooming)
        }
        return
      }
      // Fingers on a touchpad take over from a notch on its way.
      zoomGoal = null
      camera = turned(camera, said)
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
    if (!(event.target instanceof Element) || !event.target.closest('.floor')) return
    handTakes()
    touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.target.setPointerCapture(event.pointerId)
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

  /** The layer under the panes, put first among them: drawn before every pane, and under
   *  the bar. Moved back out as the layer goes, since it is no longer where it was made. */
  function beneathPanes(node: HTMLElement) {
    const layer = node.firstElementChild
    const panes = document.querySelector('[data-panes]')
    if (layer && panes) panes.prepend(layer)
    return {
      destroy() {
        layer?.remove()
      },
    }
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
  <!-- Under the panes, which stand on it: the bubbles, the lines between a split's sides,
       and the names under the windows, all of them before any window, so a window is
       never under a name. Put among the panes themselves (`beneathPanes`), since a pane
       moving as its window is drawn where the panes are drawn. -->
  <div class="beneath" use:beneathPanes>
    <div
      class="under"
      style:--overview-top="{barBottom}px"
      aria-hidden="true"
      onselectstart={(event) => event.preventDefault()}
      ondragstart={(event) => event.preventDefault()}
    >
      <div
        class="world"
        style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
        style:--overview-unzoom={Math.max(1, 1 / camera.zoom)}
      >
        {#if cellsShown.length}
          <Cells cells={cellsShown} pushed={pushedNow} holding={held !== null} inside={insideOf} />
        {/if}
        <svg class="seams" width="1" height="1">
          {#each laid.seams as seam (seam.id)}
            <path d={seamPath(seam)} />
          {/each}
        </svg>
        {#each windows as { slot, tab } (tab.id)}
          <span
            class="caption"
            style:translate="{slot.x}px {slot.y + slot.h + 8}px"
            style:width="calc({slot.w}px / var(--overview-unzoom))"
            use:named={tab.id}
          >
            <TabMark {tab} /><span class="caption-name">{tab.shown}</span>
          </span>
        {/each}
      </div>
    </div>
  </div>

  <!-- Asked for under Appearance: the app behind the canvas, blurred, its sidebars where
       they are. Otherwise there is nothing here at all: the sidebars slide away and the
       canvas is the ground the panes stand on. -->
  {#if modes.overviewBlur}
    <div
      class="nib-scrim ground is-blurred"
      style:top="{barBottom}px"
      aria-hidden="true"
      bind:this={ground}
    ></div>
  {/if}

  <!-- A clear scrim, so a web page's live view steps behind its picture from the first
       frame to the last (web-tab/covers.ts); it draws nothing and takes no press itself -
       the bar over it is the window's still, and the floor under the windows is what a
       press on the canvas lands on. -->
  <div
    class="nib-scrim is-clear canvas"
    style:--overview-top="{barBottom}px"
    bind:this={canvasNode}
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
    onselectstart={(event) => event.preventDefault()}
    ondragstart={(event) => event.preventDefault()}
  >
    <div class="floor" aria-hidden="true"></div>

    <div class="top">
      {#if spaces.length > 1}
        <!-- All spaces or This space: whether the other spaces' cells are there too. -->
        <Select
          value={all ? 'all' : 'this'}
          options={[
            { value: 'all', label: t('All spaces') },
            { value: 'this', label: t('This space') },
          ]}
          onchange={(value) => showAll(value === 'all')}
          label={t('Spaces')}
        />
      {/if}
      <button class="nib-button is-quiet tidy" type="button" onclick={() => void tidy()}
        >{t('Tidy up')}</button
      >
    </div>

    <div
      class="world"
      style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
      style:--overview-unzoom={Math.max(1, 1 / camera.zoom)}
    >
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
            <!-- A pane that is its window is under it, and the window only its ring. -->
            {#if !asPanes[tab.id]}
              <WindowFace {tab} face={faces.of(tab.id)} width={face.w} height={face.h} />
            {/if}
          </span>
          <span class="chip" class:is-copy={!!tabsAsDrawn[tab.id]} aria-hidden="true">
            {#if tabsAsDrawn[tab.id]}
              <span class="chip-copy" use:holdingTab={tabsAsDrawn[tab.id]}></span>
            {:else}
              <span class="chip-inner"
                ><TabMark {tab} /><span class="chip-name">{tab.shown}</span></span
              >
            {/if}
          </span>
          <span class="ring" aria-hidden="true"></span>
        </button>
        <!-- Its cross, on its corner while the pointer is on it: beside the window and not
             in it, a button in a button being no button at all. -->
        <button
          class="closer"
          class:is-held={held?.id === tab.id}
          type="button"
          tabindex="-1"
          title={t('Close')}
          aria-label={t('Close')}
          style:translate="{slot.x + slot.w}px {slot.y}px"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => shut(event, tab)}
          use:closing={tab.id}
        >
          <Cross />
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* The window as it is, but for its sidebars: they slide away, the left one to the left
     and the right one to the right, as if each were shut, as far as the overview is out -
     moved and not shut, so nothing is laid out again and the panes stay where they are.
     What they uncover is the ground they stood on, which is the canvas's. */
  :global(html[data-overview='slide'] [data-chrome='start']) {
    translate: calc(var(--dir, 1) * -100% * var(--overview-open, 0)) 0;
  }

  :global(html[data-overview='slide'] [data-chrome='end']) {
    translate: calc(var(--dir, 1) * 100% * var(--overview-open, 0)) 0;
  }

  /* Asked for under Appearance: the app under the bar, blurred far enough to be a surface
     and not a page, as the overview was drawn first - over the sidebars, which stay, and
     under the panes and what lies under them, which stand on it. */
  .ground.is-blurred {
    --scrim-z: var(--z-raised);
    opacity: 0;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    -webkit-backdrop-filter: blur(28px);
    backdrop-filter: blur(28px);
  }

  /* The sizes of what the overview says in words, in one place: a window's name and a
     space's, never smaller on the screen than these, however far out the camera is
     (`--overview-unzoom` scales them back by as much as the camera makes them small). */
  .canvas {
    --overview-caption: var(--text-base);
    --overview-cell-name: calc(var(--text-base) * 1.6);
    position: fixed;
    inset: 0;
    /* Over the panes, and just under a sheet: what the overview asks - a terminal still
       running, words with no file, closed by a window's cross - comes up over it, and is
       answered there. */
    z-index: calc(var(--z-sheet) - 1);
    overflow: hidden;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    /* Nothing but its windows, its row and its floor takes a press: the bar stays the
       window's. */
    pointer-events: none;
    outline: none;
    touch-action: none;
    /* Windows are pictures of their tabs, not their words: nothing here is chosen as
       text, and a drag is the overview's own, never the browser's. */
    user-select: none;
    -webkit-user-select: none;
  }

  /* The canvas between the windows, under the bar, which a press, a drag or a pinch on
     the canvas lands on. */
  .floor {
    position: absolute;
    inset: 0;
    top: var(--overview-top, 0);
    pointer-events: auto;
  }

  .top {
    position: absolute;
    z-index: var(--z-raised);
    top: calc(var(--overview-top, 0px) + var(--space-3));
    pointer-events: auto;
    left: 50%;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    translate: -50% calc((1 - var(--overview-open, 0)) * -8px);
    opacity: var(--overview-open, 0);
  }

  /* Tidy up, the app's own button, beside the dropdown. */
  .tidy {
    white-space: nowrap;
  }

  /* The anchor the layer under the panes is made in, and moved out of. */
  .beneath {
    display: none;
  }

  /* Under the panes and over the ground they stand on, cut off at the bar. */
  .under {
    --overview-caption: var(--text-base);
    --overview-cell-name: calc(var(--text-base) * 1.6);
    position: fixed;
    inset: 0;
    /* Level with the panes moving as their windows (`movePane`), and before them. */
    z-index: var(--z-raised);
    overflow: hidden;
    clip-path: inset(var(--overview-top, 0) 0 0 0);
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
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
    opacity: var(--overview-open, 0);
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
    /* No ground of its own: its face has one, and as a tab it is the strip's, which
       draws its tabs on the chrome. */
    background: none;
    /* Lifted off the canvas as far as the overview is out: none at all on the first
       frame and the last, where a window is its pane. */
    box-shadow: 0 calc(24px * var(--overview-open, 1)) calc(64px * var(--overview-open, 1))
      calc(-12px * var(--overview-open, 1)) rgb(0 0 0 / 0.26);
    will-change: transform;
    cursor: pointer;
    outline: none;
    touch-action: none;
    pointer-events: auto;
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

  /* The tab it was, at the tab's own size whatever the window's scale: the strip's own
     tab copied where there is one, which draws its own ground. */
  .chip.is-copy {
    background: none;
  }

  .chip-copy {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
  }

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
    /* None on the first frame and the last, where the window is its pane or its tab. */
    opacity: var(--overview-open, 1);
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

  /* A window's cross: the app's quiet grey button with the cross in it red, small, on
     the window's top right corner itself, at the same size on the screen whatever the
     zoom, there while the pointer is on the window or on the cross, and only once the
     window is in its place. Under the pointer the button lights as a quiet one does, its
     cross goes a step deeper and it grows a little, so it is plain that a press closes
     the tab. */
  .closer {
    --closer-size: 22px;
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--closer-size);
    height: var(--closer-size);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    color: var(--danger);
    /* Solid, half of it being over the canvas and half over the window. */
    background: var(--surface-2);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.22);
    transform-origin: 0 0;
    scale: var(--overview-unzoom);
    /* Its middle on the corner: scaled about that point, so it grows in place. */
    transform: scale(1) translate(-50%, -50%);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .closer :global(.nib-cross) {
    width: 12px;
    height: 12px;
    stroke-width: 2.25;
  }

  .window:hover + .closer,
  .closer:hover,
  .closer:focus-visible {
    opacity: var(--near, 0);
    pointer-events: auto;
  }

  .closer.is-held {
    visibility: hidden;
  }

  /* The quiet button's hover and press, laid on its own grey so it stays solid; the
     cross deeper towards the ink, as a button that deletes is (base.css). */
  .closer:hover,
  .closer:focus-visible {
    color: color-mix(in srgb, var(--danger) 86%, var(--text-strong));
    background: linear-gradient(var(--surface-hover), var(--surface-hover)), var(--surface-2);
    transform: scale(1.18) translate(-50%, -50%);
  }

  .closer:active {
    background: linear-gradient(var(--surface-press), var(--surface-press)), var(--surface-2);
    transform: scale(0.94) translate(-50%, -50%);
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
    font-size: var(--overview-caption);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform-origin: 0 0;
    scale: var(--overview-unzoom);
  }
</style>
