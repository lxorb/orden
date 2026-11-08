<script lang="ts">
  import { tick as laidOut, untrack } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { key, t } from '../i18n.svelte'
  import { chorded } from '../keys'
  import { stillness } from '../motion'
  import { overlays } from '../overlays'
  import Cross from '../Cross.svelte'
  import Select from '../Select.svelte'
  import { tabOverview } from '../surfaces.svelte'
  import TabMark from '../TabMark.svelte'
  import { trap } from '../trap'
  import { prompt } from '../prompt.svelte'
  import { pages } from '../web-tab/pages.svelte'
  import { isDraft } from '../workspace/drafts'
  import { type Tab, workspace } from '../workspace.svelte'
  import {
    aimed,
    boxToCanvas,
    type Camera,
    eased,
    isOnView,
    lookingAt,
    overlooking,
    pinched,
    type Point,
    showing,
    toCanvas,
    zoomedAt,
    moved as panned,
  } from './camera'
  import { isDrag, type Landing } from './drag'
  import { places } from './places.svelte'
  import { type Cell, cellAt } from './cells'
  import Cells from './Cells.svelte'
  import { boundsOf, boxOutline, moved as shifted, type Outline, outlineOf } from './outline'
  import { modes } from '../modes.svelte'
  import { keep, storedText } from '../stored'
  import { canWriteAt } from '../sharing.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { mayCarry } from '../workspace/chat-carry'
  import { TAB_KINDS } from '../workspace/tab-kinds'
  import type { Frame } from '../workspace/pane-tree'
  import { movingOf, spacesFor } from '../workspace/space-move'
  import { faces } from './faces.svelte'
  import { type Corners, drawn, Flight, paneDrawn, type Pose } from './flight'
  import { land as landSpring, resting as sprung, SHARE, spring, step } from './spring'
  import { keptAt, readsBefore, roomFor, settled, stripLanding } from './free'
  import { meets, packed, pushedAside } from './pack'
  import {
    around,
    type Box,
    type Laid,
    lay,
    seamPath,
    seamsAmong,
    type Slot,
    WIDEST,
  } from './layout'
  import { marked, shownBox, tabCopyOf } from './mirror'
  import { walk, wayOf } from './walk'
  import WindowFace from './WindowFace.svelte'

  let shown = $state(false)
  let out = $state(false)

  let width = $state(window.innerWidth)
  let height = $state(window.innerHeight)

  const MARGIN = 56
  const ROW = 60

  let barBottom = $state(0)

  function barOf(): number {
    const bar = document.querySelector('header[data-chrome="top"]')?.getBoundingClientRect()
    return bar && bar.height > 0 ? Math.max(0, bar.bottom) : 0
  }

  const roomTop = $derived((barBottom > 0 ? barBottom : ROW) + MARGIN / 2)

  let panes = $state<Record<string, { w: number; h: number }>>({})
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written as the layer comes up, read once a frame
  const panesAsWindows = new Map<
    string,
    { node: HTMLElement; box: DOMRect; head: number; corners: Corners }
  >()
  let asPanes = $state<Record<string, true>>({})
  let tabsAsDrawn = $state<Record<string, HTMLElement>>({})
  let ridersDrawn = $state<Record<string, HTMLElement>>({})

  const frame = $derived(workspace.panes.frame)
  const screenRoom = $derived<Box>({
    x: MARGIN,
    y: roomTop,
    w: Math.max(width - 2 * MARGIN, 200),
    h: Math.max(height - roomTop - MARGIN, 160),
  })

  const spaceKey = $derived(workspace.activeSpaceId ?? 'global')
  const room = $derived<Box>(
    places.at(spaceKey) ?? { x: 0, y: 0, w: screenRoom.w, h: screenRoom.h },
  )

  let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 })
  let unmoved = false

  function lookAtSpace() {
    placeNew([spaceKey])
    const place = places.place(spaceKey, { w: screenRoom.w, h: screenRoom.h })
    camera = lookingAt(place, screenRoom)
    const cell = cellBoxes.find((one) => one.key === spaceKey)
    if (!all || !cell) return
    camera = overlooking(wholeOf([cell]), wholeOf(cellBoxes), screenRoom, windowWide())
  }

  function windowWide(): number {
    const wide = resting.map((one) => one.w).sort((a, b) => a - b)
    return wide[Math.floor(wide.length / 2)] ?? screenRoom.w * WIDEST
  }

  function wholeOf(cells: readonly Cell[]): Box {
    return around(cells.flatMap(({ key }) => outlineAt(key) ?? []).map(boundsOf)) ?? room
  }

  const CELLS_APART = 4

  function nameWide(key: string): number {
    const name = [...document.querySelectorAll<HTMLElement>('[data-space-name]')].find(
      (one) => one.dataset.spaceName === key,
    )
    const said = workspace.spaces.find((space) => space.id === key)?.name ?? ''
    const wide = name && name.offsetWidth > 0 ? name.offsetWidth : said.length * 13
    return wide * SPACE_NAMES_MOST
  }

  function outlineFor(key: string, boxes: readonly Box[]): Outline | null {
    return outlineOf(boxes.map(captioned), NAME_ROOM, nameWide(key))
  }

  function outlineAt(key: string): Outline | null {
    const inside = resting.filter((slot) => cellOf.get(slot.id) === key && !heldIds.has(slot.id))
    if (inside.length) return outlineFor(key, inside)
    return outlineOf([standIn(placeOf(key))], NAME_ROOM, nameWide(key))
  }

  function cellAlone(key: string): Outline | null {
    const panesOf = key === spaceKey ? frame : sets?.frameOf(key)
    if (!panesOf) return null
    const corner = { x: 0, y: 0, w: screenRoom.w, h: screenRoom.h }
    const slots = lay(panesOf, corner, { tabsOf, shapeOf }).slots
    if (slots.length) return outlineFor(key, slots)
    return outlineOf([standIn(corner)], NAME_ROOM, nameWide(key))
  }

  function standIn(place: Box): Box {
    const w = (place.w * WIDEST) / 2
    const h = (w * place.h) / Math.max(place.w, 1)
    return { x: place.x + (place.w - w) / 2, y: place.y + (place.h - h) / 2, w, h }
  }

  function placeOf(key: string): Box {
    return key === spaceKey ? room : (places.at(key) ?? room)
  }

  function packedPlaces(keys: readonly string[], taken: readonly Outline[], middle: Point) {
    const cells = keys.flatMap((key) => {
      const outline = cellAlone(key)
      return outline ? [{ key, outline }] : []
    })
    const spots = packed(cells, CELLS_APART, taken, middle, screenRoom.w / screenRoom.h)
    const out: Record<string, Box> = {}
    for (const { key } of cells) {
      const spot = spots[key]
      if (spot) out[key] = { x: spot.x, y: spot.y, w: screenRoom.w, h: screenRoom.h }
    }
    return out
  }

  function placeNew(keys: readonly string[]) {
    const fresh = keys.filter((key) => !places.at(key))
    if (!fresh.length) return
    const known = new Set(cellBoxes.map((one) => one.key))
    const taken = Object.entries(places.every()).map(
      ([key, place]) => (known.has(key) ? outlineAt(key) : null) ?? boxOutline(place),
    )
    const whole = around(taken.map(boundsOf))
    const middle = whole
      ? { x: whole.x + whole.w / 2, y: whole.y + whole.h / 2 }
      : { x: screenRoom.w / 2, y: screenRoom.h / 2 }
    places.arrange(packedPlaces(fresh, taken, middle))
  }

  async function tidy() {
    const keys = [spaceKey, ...shownKeys.filter((key) => key !== spaceKey)]
    places.tidy(packedPlaces(keys, [], { x: 0, y: 0 }))
    for (const key of shownKeys) places.place(key, { w: screenRoom.w, h: screenRoom.h })
    await laidOut()
    flyTo(lookingAt(wholeOf(cellBoxes), screenRoom))
  }

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

  function handTakes() {
    unmoved = false
    flyGoal = null
    cancelAnimationFrame(flyFrame)
    flyFrame = 0
  }

  const NAME_ROOM = 72
  const SPACE_NAMES_MOST = 2
  const NAMES_MOST = 1.8

  const shapeOf = (paneId: string): number => {
    const measured = shownBox(paneId)
    const box = panes[paneId] ?? (measured && { w: measured.width, h: measured.height })
    return box && box.w > 0 && box.h > 0 ? box.w / box.h : 16 / 10
  }

  const tabsOf = (paneId: string) => workspace.tabsIn(paneId).map((tab) => tab.id)

  const ALL = 'orden:overview-spaces'
  let all = $state(storedText(ALL) !== 'this')

  function showAll(on: boolean) {
    all = on
    keep(ALL, on ? 'all' : 'this')
  }

  let sets = $state<{ frameOf: (key: string) => Frame | null } | null>(null)
  $effect(() => {
    if (all && !sets) void import('../workspace/sets.svelte').then((one) => (sets = one.sets))
  })

  const shownKeys = $derived.by((): string[] => {
    const others = all && sets && workspace.activeSpaceId ? workspace.shownSpaces : []
    const keys = others.map((one) => one.id).filter((key) => key !== spaceKey && sets?.frameOf(key))
    return [spaceKey, ...keys]
  })

  $effect(() => {
    const keys = shownKeys
    untrack(() => {
      placeNew(keys)
      for (const key of keys) places.place(key, { w: screenRoom.w, h: screenRoom.h })
      apartAll()
      if (unmoved && shown && out) lookAtSpace()
    })
  })

  function apartAll() {
    const taken: Outline[] = []
    const order = [...cellBoxes].sort(
      (a, b) => Number(b.key === spaceKey) - Number(a.key === spaceKey),
    )
    for (const { key } of order) {
      const outline = outlineAt(key)
      if (!outline) continue
      if (!taken.some((one) => meets(one, outline, CELLS_APART))) {
        taken.push(outline)
        continue
      }
      const box = boundsOf(outline)
      const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
      const spot = packed([{ key, outline }], CELLS_APART, taken, middle)[key]
      if (!spot) continue
      shiftSpace(key, spot.x, spot.y)
      taken.push(shifted(outline, spot.x, spot.y))
    }
  }

  let held = $state<{
    id: string
    fx: number
    fy: number
    box: Box | null
    landing: (Landing & { kind: 'space' }) | null
    from: string
    goes: readonly string[]
    with: readonly { id: string; dx: number; dy: number; w: number; h: number }[]
    whole: string | null
  } | null>(null)

  let chosen = $state<readonly string[]>([])

  const heldBoxes = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- made afresh by the derived, never changed after
    const boxes = new Map<string, Box>()
    const box = held?.box
    if (!held || !box) return boxes
    boxes.set(held.id, box)
    for (const one of held.with)
      boxes.set(one.id, { x: box.x + one.dx, y: box.y + one.dy, w: one.w, h: one.h })
    return boxes
  })

  const heldIds = $derived<ReadonlySet<string>>(
    new Set(held ? [held.id, ...held.with.map((one) => one.id)] : []),
  )

  const gridCells = $derived(
    shownKeys.flatMap((key) => {
      const own = key === spaceKey
      const panesOf = own ? frame : sets?.frameOf(key)
      if (!panesOf) return []
      const place = placeOf(key)
      return [
        {
          key,
          frame: panesOf,
          slots: lay(panesOf, place, { tabsOf, shapeOf }).slots,
        },
      ]
    }),
  )

  const resting = $derived.by(() => {
    const put = places.windows
    const all = gridCells.flatMap((one) => one.slots)
    const lying = all.map((slot) => {
      const box = put[slot.id]
      return box ? keptAt(slot, box) : slot
    })
    return settled(lying, new Set(all.filter((one) => put[one.id]).map((one) => one.id)), 0, false)
  })

  const cellOf = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- made afresh by the derived, never changed after
    const map = new Map(
      gridCells.flatMap((one) => one.slots.map((slot) => [slot.id, one.key] as const)),
    )
    const landing = held?.landing
    if (landing?.kind === 'space') for (const id of heldIds) map.set(id, landing.key)
    return map
  })

  const slots = $derived.by((): Slot[] => {
    const id = held?.id
    const key = id ? cellOf.get(id) : undefined
    const made =
      heldBoxes.size && id ? roomFor(resting, heldBoxes, (one) => cellOf.get(one) === key) : resting
    if (!Object.keys(aside).length) return made
    return made.map((slot) => {
      const by = offsetOf(cellOf.get(slot.id) ?? '')
      return by ? { ...slot, x: slot.x + by.x, y: slot.y + by.y } : slot
    })
  })

  let aside = $state<Record<string, Point>>({})

  function offsetOf(key: string): Point | null {
    return aside[key] ?? null
  }

  function pushAside() {
    const whole = held?.whole
    const carried = whole ? outlineFor(whole, [...heldBoxes.values()]) : null
    if (!whole || !carried) return
    const others = cellBoxes.flatMap((one) => {
      const outline = one.key === whole ? null : outlineAt(one.key)
      return outline ? [{ key: one.key, outline }] : []
    })
    aside = pushedAside(carried, others, CELLS_APART, aside)
  }

  const laid = $derived({
    slots,
    seams: gridCells.flatMap((one) =>
      seamsAmong(
        one.frame,
        slots.filter((slot) => cellOf.get(slot.id) === one.key && !heldIds.has(slot.id)),
      ),
    ),
  })

  const cellBoxes = $derived<Cell[]>(
    gridCells.map((one) => {
      const inside = resting.filter(
        (slot) => cellOf.get(slot.id) === one.key && !heldIds.has(slot.id),
      )
      const from = resting.filter(
        (slot) => heldIds.has(slot.id) && one.slots.some((own) => own.id === slot.id),
      )
      const lying = around(inside) ?? around(from)
      return { key: one.key, box: lying ? captioned(lying) : standIn(placeOf(one.key)) }
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
  const slotOf = $derived(new Map(laid.slots.map((slot) => [slot.id, slot])))
  const unzoom = $derived(Math.max(1, 1 / camera.zoom))
  const windows = $derived(
    laid.slots.flatMap((slot) => {
      const tab = byId.get(slot.id)
      return tab ? [{ slot, tab }] : []
    }),
  )

  function faceOf(slot: Slot) {
    const pane = panes[slot.paneId]
    if (pane && pane.w > 0) return { w: pane.w, h: pane.w * (slot.h / slot.w) }
    return { w: slot.w * 3, h: slot.h * 3 }
  }

  const CAPTION_ROOM = 44

  function captioned(box: Box): Box {
    return { ...box, h: box.h + CAPTION_ROOM }
  }

  const CAPTION_NEAR = 60

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const flights = new Map<string, Flight>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const elements = new Map<
    string,
    { window: HTMLElement; face: HTMLElement; chip: HTMLElement; ring: HTMLElement }
  >()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const captions = new Map<string, HTMLElement>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const closers = new Map<string, HTMLElement>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once a frame, never rendered
  const arrived = new Set<string>()

  function insideOf(key: string): Box[] {
    const boxes: Box[] = []
    for (const slot of laid.slots) {
      if (heldIds.has(slot.id) || cellOf.get(slot.id) !== key) continue
      const pose = arrived.has(slot.id) ? flights.get(slot.id)?.pose : null
      boxes.push(captioned(pose ? { x: pose.x, y: pose.y, w: pose.w, h: pose.h } : slot))
    }
    if (boxes.length || laid.slots.some((slot) => cellOf.get(slot.id) === key)) return boxes
    const empty = standIn(placeOf(key))
    const by = offsetOf(key)
    return [by ? { ...empty, x: empty.x + by.x, y: empty.y + by.y } : empty]
  }

  function homeOf(tab: Tab, slot: Slot): Pose {
    if (workspace.panes.at(tab.paneId)?.activeTabId === tab.id) {
      const laidOut = panesAsWindows.get(tab.id)
      const box = laidOut
        ? new DOMRect(
            laidOut.box.x,
            laidOut.box.y + laidOut.head,
            laidOut.box.width,
            laidOut.box.height - laidOut.head,
          )
        : shownBox(tab.paneId)
      if (box && box.width > 0) {
        rides(tab.id, box)
        return onCanvas(box, 0)
      }
    }
    riders.delete(tab.id)
    const chip = marked('box', tab.id)?.getBoundingClientRect()
    if (chip && chip.width > 0 && chip.right > 0 && chip.left < width) return onCanvas(chip, 1)
    return { ...lifted(slot), alpha: 0 }
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once a frame, never rendered
  const riders = new Map<string, { dx: number; dy: number; width: number }>()

  function rides(id: string, box: DOMRect) {
    const chip = marked('box', id)?.getBoundingClientRect()
    if (!chip || chip.width <= 0) return void riders.delete(id)
    riders.set(id, { dx: chip.x - box.x, dy: chip.y - box.y, width: box.width })
  }

  function onCanvas(box: DOMRect, tab: number): Pose {
    const { x, y, w, h } = boxToCanvas(camera, { x: box.x, y: box.y, w: box.width, h: box.height })
    return { x, y, w, h, tab, alpha: 1 }
  }

  const lying = (slot: Slot): Pose => ({
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    tab: 0,
    alpha: 1,
  })

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

  let at = $state<string | null>(null)

  let frameAsked = 0
  let last = 0

  const READY = 250
  const LONGEST_FRAME = 1 / 30
  let unready = 0
  let entered = 0
  let stood = true
  const STANDS = 1500

  function readying(done: Promise<unknown>) {
    if (started) return
    unready++
    const settled = () => {
      unready--
    }
    void done.then(settled, settled)
  }

  function fly() {
    if (frameAsked) return
    last = performance.now()
    frameAsked = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    frameAsked = 0
    if (
      !started &&
      ((unready > 0 && now - entered < READY) || (!stood && now - entered < STANDS))
    ) {
      last = now
      frameAsked = requestAnimationFrame(tick)
      return
    }
    const seconds = started ? Math.min(Math.max(0, (now - last) / 1000), LONGEST_FRAME) : 0
    last = now
    if (!started) begin()
    opening.to = out ? 1 : 0
    step(opening, seconds)
    opened(opening.at)
    let moving = !sprung(opening)
    for (const [id, flight] of flights) {
      if (!flight.step(seconds)) moving = true
      else if (out) arrived.add(id)
      if (heldIds.has(id)) follow(id)
      else paint(id)
    }
    awayFromStrip()
    if (moving) fly()
    else {
      landSpring(opening)
      opened(opening.at)
      landed()
      if (!out) gone()
    }
  }

  let onTheWay = $state(false)

  const stageSize = $derived.by(() => {
    const boxes = Object.values(panes).filter((one) => one.w > 0 && one.h > 0)
    const widest = boxes.sort((a, b) => b.w * b.h - a.w * a.h)[0]
    return { w: Math.round(widest?.w ?? 1200), h: Math.round(widest?.h ?? 800) }
  })

  function landed() {
    if (!onTheWay) return
    onTheWay = false
    for (const [id, one] of panesAsWindows) {
      const pose = flights.get(id)?.pose
      if (pose) movePane(id, pose)
      else putBack(one.node)
    }
    for (const id of flights.keys()) paint(id)
  }

  function stackOf(id: string): string {
    if (heldIds.has(id)) return 'calc(var(--z-bar) - 1)'
    return id === workspace.activeTabId ? 'var(--z-float)' : 'var(--z-popover)'
  }

  const opening = spring(0, SHARE)
  let ground = $state<HTMLElement>()
  let canvasNode = $state<HTMLElement>()
  let top = $state<HTMLElement>()
  let under = $state<HTMLElement>()
  let bar: HTMLElement | null = null

  let opens: HTMLElement[] = []
  let slides: HTMLElement[] = []

  function opensOf() {
    opens = [
      ...document.querySelectorAll<HTMLElement>(
        "header[data-chrome='top'] :is(button, [role='button']), [data-side-toggle], [data-pane]:has(> .here)",
      ),
    ]
    slides = [
      ...document.querySelectorAll<HTMLElement>("[data-chrome='start'], [data-chrome='end']"),
    ]
    bar = document.querySelector<HTMLElement>("header[data-chrome='top']")
  }

  function opened(at: number) {
    const value = String(Math.round(at * 1000) / 1000)
    for (const one of [...opens, under, top]) one?.style.setProperty('--overview-open', value)
    for (const one of slides) one.style.setProperty('--overview-slide', value)
    bar?.style.setProperty('--overview-bar', value)
    if (ground) {
      ground.style.opacity = value
      ground.style.visibility = at < 0.01 ? 'hidden' : ''
    }
  }

  let started = true

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once a frame, never rendered
  const homes = new Map<string, Pose>()

  const NEAR = 14

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
    onTheWay = true
    document.documentElement.dataset.overview = modes.overviewBlur ? 'blur' : 'slide'
    opensOf()
    for (const id of flights.keys()) paint(id)
  }

  function paint(id: string) {
    const flight = flights.get(id)
    const parts = elements.get(id)
    const slot = slotOf.get(id)
    if (!flight || !parts || !slot) return
    const pose = flight.pose
    const styles = drawn(pose, slot.w, slot.h, corner, camera)
    const home = started ? (out ? null : fromHome(id)) : 0
    if (home !== null && home < NEAR)
      styles.window.opacity = String(Number(styles.window.opacity) * (home / NEAR))
    Object.assign(parts.window.style, styles.window)
    Object.assign(parts.face.style, styles.face)
    Object.assign(parts.chip.style, styles.chip)
    parts.window.style.setProperty('--overview-lift', String(opening.at))
    parts.ring.style.setProperty('--overview-open', String(opening.at))
    parts.ring.style.setProperty('--flight-x', String(slot.w / Math.max(pose.w, 1)))
    parts.ring.style.setProperty('--flight-y', String(slot.h / Math.max(pose.h, 1)))
    paintRider(id, home)
    if (started) movePane(id, pose)
    const off =
      Math.abs(pose.x - slot.x) +
      Math.abs(pose.y - slot.y) +
      Math.abs(pose.w - slot.w) +
      Math.abs(pose.h - slot.h)
    const near = Math.max(0, 1 - off / CAPTION_NEAR) * Math.max(0, 1 - pose.tab * 3) * pose.alpha
    const caption = captions.get(id)
    if (caption) caption.style.opacity = String(near)
    const closer = closers.get(id)
    if (!closer) return
    const cornerY = camera.y + slot.y * camera.zoom
    closer.style.setProperty('--near', String(near))
    closer.style.translate = `${camera.x + (slot.x + slot.w) * camera.zoom}px ${cornerY}px`
    closer.style.visibility = cornerY < barBottom ? 'hidden' : ''
  }

  function paintRider(id: string, near: number | null = null) {
    const node = riderNodes.get(id)
    if (!node) return
    const at = riders.get(id)
    const pose = flights.get(id)?.pose
    const slot = slotOf.get(id)
    const home = homes.get(id)
    if (!at || !pose || !slot || !home || home.tab >= 0.5 || home.alpha < 0.5) {
      node.style.opacity = '0'
      return
    }
    const scale = (pose.w * camera.zoom) / Math.max(at.width, 1)
    const x = camera.x + pose.x * camera.zoom + at.dx * scale
    const y = camera.y + pose.y * camera.zoom + at.dy * scale
    const span = home.w - slot.w
    const down = Math.abs(span) > 1 ? (home.w - pose.w) / span : opening.at
    let alpha = Math.min(1, Math.max(0, 1 - down / 0.6)) * pose.alpha
    if (near !== null && near < NEAR) alpha *= near / NEAR
    node.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    node.style.opacity = String(alpha)
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const riderNodes = new Map<string, HTMLElement>()

  function riding(node: HTMLElement, id: string) {
    const copy = ridersDrawn[id]
    if (copy) node.replaceChildren(copy)
    riderNodes.set(id, node)
    paintRider(id, started ? null : 0)
    return {
      destroy() {
        if (riderNodes.get(id) === node) riderNodes.delete(id)
      },
    }
  }

  function movesAsWindow(id: string): boolean {
    const pane = byId.get(id)?.paneId
    return panesAsWindows.has(id) && !!pane && workspace.panes.at(pane)?.activeTabId === id
  }

  function movePane(id: string, pose: Pose) {
    const one = panesAsWindows.get(id)
    if (!one) return
    if (!movesAsWindow(id)) return putBack(one.node)
    const styles = paneDrawn(pose, camera, one.box, one.head, corner, opening.at, one.corners)
    Object.assign(one.node.style, styles, {
      transformOrigin: '0 0',
      zIndex: stackOf(id),
      pointerEvents: 'none',
    })
  }

  $effect(() => {
    const looking = { ...camera }
    untrack(() => {
      if (!shown || !started || looking.zoom <= 0) return
      for (const id of flights.keys()) paint(id)
    })
  })

  const PANE_STYLES = [
    'transform',
    'transform-origin',
    'clip-path',
    'opacity',
    'z-index',
    'pointer-events',
  ]

  function putBack(node: HTMLElement) {
    for (const name of PANE_STYLES) node.style.removeProperty(name)
  }

  function aimAll() {
    const hands = untrack(() => heldIds)
    for (const { slot, tab } of untrack(() => windows)) {
      if (hands.has(tab.id)) continue
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
      landed()
      if (!out) gone()
      return
    }
    fly()
  }

  let corner = 0

  function cardCorner(): number {
    return (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-radius')) || 0
    )
  }

  function cornersOf(node: HTMLElement): Corners {
    const style = getComputedStyle(node)
    const of = (one: string) => parseFloat(one) || 0
    return [
      of(style.borderTopLeftRadius),
      of(style.borderTopRightRadius),
      of(style.borderBottomRightRadius),
      of(style.borderBottomLeftRadius),
    ]
  }

  function enter() {
    const again = shown
    if (!again) {
      corner = cardCorner()
      barBottom = barOf()
      places.recall(workspace.tabs)
      entered = performance.now()
      started = false
      readying(faces.read())
      const holding = pages.holdStill()
      stood = holding === null
      void holding?.finally(() => (stood = true))
      measure()
      lookAtSpace()
      unmoved = true
      const kept = places.camera
      const front =
        slots.find((one) => one.id === workspace.activeTabId) ??
        cellBoxes.find((one) => one.key === spaceKey)?.box
      if (kept && (!front || isOnView(kept, front, screenRoom))) {
        camera = kept
        unmoved = false
      }
      panesAsWindows.clear()
      riders.clear()
      const asWindows: Record<string, true> = {}
      for (const pane of workspace.panes.all) {
        const tab = pane.activeTabId ? byId.get(pane.activeTabId) : undefined
        if (!tab) continue
        const node = marked('pane', pane.id)
        const box = node?.getBoundingClientRect()
        if (!node || !box || box.width <= 0 || box.height <= 0) continue
        const head = node.querySelector(':scope > .head')?.getBoundingClientRect().height ?? 0
        panesAsWindows.set(tab.id, { node, box, head, corners: cornersOf(node) })
        asWindows[tab.id] = true
        faces.take(pane.id, tab)
      }
      asPanes = asWindows
      const inherited = new Map<Element, string>()
      const tabCopies: Record<string, HTMLElement> = {}
      const riderCopies: Record<string, HTMLElement> = {}
      for (const tab of workspace.tabs) {
        const copy = tabCopyOf(tab.id, inherited)
        if (copy) tabCopies[tab.id] = copy
        const rider = copy && tabCopyOf(tab.id, inherited)
        if (rider) riderCopies[tab.id] = rider
      }
      tabsAsDrawn = tabCopies
      ridersDrawn = riderCopies
      at = workspace.activeTabId
      homes.clear()
    }
    shown = true
    out = true
    if (again) {
      onTheWay = true
      aimAll()
    }
  }

  function measure() {
    const measured: Record<string, { w: number; h: number }> = {}
    for (const pane of workspace.panes.all) {
      const box = shownBox(pane.id)
      if (box) measured[pane.id] = { w: box.width, h: box.height }
    }
    panes = measured
  }

  $effect(() => arrivedIn(spaceKey))

  function arrivedIn(space: string) {
    if (space && untrack(() => shown && out)) untrack(lookAtSpace)
  }

  function leave() {
    held = null
    pressed = null
    carrying = null
    aside = {}
    touching.clear()
    panning = false
    chosen = []
    if (zoomGoal) camera = eased(camera, zoomGoal.zoom, zoomGoal.at, Number.POSITIVE_INFINITY)
    zoomGoal = null
    cancelAnimationFrame(zoomFrame)
    zoomFrame = 0
    places.remember(camera)
    out = false
    arrived.clear()
    if (started) onTheWay = true
    aimAll()
  }

  function gone() {
    homes.clear()
    shown = false
    flights.clear()
    for (const { node } of panesAsWindows.values()) putBack(node)
    panesAsWindows.clear()
    asPanes = {}
    tabsAsDrawn = {}
    ridersDrawn = {}
    riders.clear()
    tabOverview.out = []
    tabOverview.lifted = []
    delete document.documentElement.dataset.overview
    void pages.letGo()
    for (const one of opens) one.style.removeProperty('--overview-open')
    for (const one of slides) one.style.removeProperty('--overview-slide')
    bar?.style.removeProperty('--overview-bar')
    bar = null
    opens = []
    slides = []
  }

  const close = () => (tabOverview.open = false)

  $effect(() => {
    if (tabOverview.open) untrack(enter)
    else if (untrack(() => shown)) untrack(leave)
  })

  let layers = 0
  $effect(() => {
    if (!shown || !tabOverview.open) return
    const gone = overlays.show(close)
    layers = overlays.depth
    return gone
  })

  function holdKeys() {
    ;(elements.get(at ?? '')?.window ?? canvasNode)?.focus({ preventScroll: true })
  }

  function keysLost() {
    if (!shown || !tabOverview.open || overlays.depth > layers) return
    const at = document.activeElement
    if (at === null || at === document.body) holdKeys()
  }
  $effect(() => {
    if (windows.length) queueMicrotask(keysLost)
  })

  function keptFromBehind(event: FocusEvent) {
    if (!shown || !tabOverview.open || overlays.depth > layers) return
    const to = event.target
    if (!(to instanceof Element) || !to.closest('[data-region]')) return
    if (to.closest('[data-notices], [role="dialog"], [role="alertdialog"]')) return
    holdKeys()
  }
  $effect(() => closeOnBack(shown && tabOverview.open, close))

  let arriving: string[] = []
  let arrivals = $state(0)

  $effect(() => {
    if (arrivals) untrack(flyIn)
  })

  function flyIn() {
    const come = arriving.filter((id) => elements.has(id) && !flights.has(id))
    arriving = []
    if (!come.length) return
    const entries = Object.fromEntries(untrack(() => windows).map((one) => [one.tab.id, one]))
    for (const id of come) {
      const entry = entries[id]
      if (!entry) continue
      const home = out ? homeOf(entry.tab, entry.slot) : null
      if (home) homes.set(id, home)
      flights.set(id, new Flight(home ?? lying(entry.slot)))
    }
    for (const id of come) paint(id)
    aimAll()
  }

  function placed(node: HTMLElement, id: string) {
    const face = node.querySelector<HTMLElement>(':scope > .face-box')
    const chip = node.querySelector<HTMLElement>(':scope > .chip')
    const ring = node.querySelector<HTMLElement>(':scope > .ring')
    if (!face || !chip || !ring) return
    elements.set(id, { window: node, face, chip, ring })
    arriving.push(id)
    arrivals++
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

  function shut(event: MouseEvent, tab: Tab) {
    event.stopPropagation()
    void workspace.closeAsking(tab.id)
  }

  $effect(() => relaid(laid))

  function relaid(now: Laid) {
    if (now.slots.length && untrack(() => shown)) untrack(aimAll)
  }

  function open(tab: Tab) {
    workspace.activate(tab.id)
    if (workspace.panes.at(tab.paneId)) close()
    else void cameForward(tab).then(close)
  }

  async function cameForward(tab: Tab) {
    for (let wait = 0; wait < 60 && !workspace.panes.at(tab.paneId); wait++) {
      await new Promise((go) => requestAnimationFrame(go))
    }
  }

  let pressed: { id: string; x: number; y: number; pointer: number; whole: string | null } | null =
    null
  let dragged = false

  function down(event: PointerEvent, id: string) {
    if (event.button !== 0 || !out) return
    pressed = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId, whole: null }
    dragged = false
    event.stopPropagation()
  }

  function clicked(event: MouseEvent, tab: Tab) {
    if (dragged) {
      dragged = false
      return
    }
    if (event.ctrlKey || event.metaKey) {
      chosen = chosen.includes(tab.id)
        ? chosen.filter((one) => one !== tab.id)
        : [...chosen, tab.id]
      return
    }
    open(tab)
  }

  function carriedWith(id: string, whole: string | null): string[] {
    const lying = (one: string) => flights.has(one) && resting.some((slot) => slot.id === one)
    if (whole)
      return [
        id,
        ...resting
          .filter((one) => cellOf.get(one.id) === whole && one.id !== id)
          .map((one) => one.id),
      ].filter(lying)
    if (chosen.includes(id)) return [id, ...chosen.filter((one) => one !== id)].filter(lying)
    chosen = []
    return [id]
  }

  function moved(event: PointerEvent) {
    if (pressed?.pointer !== event.pointerId) return
    const id = pressed.id
    if (!held) {
      if (!isDrag(event.clientX - pressed.x, event.clientY - pressed.y)) return
      const flight = flights.get(id)
      if (!flight) return
      const pose = flight.pose
      if (!pressed.whole) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      const grabbed = toCanvas(camera, pressed)
      const ids = carriedWith(id, pressed.whole)
      const first = resting.find((one) => one.id === id)
      const tabs = ids.flatMap((one) => byId.get(one) ?? [])
      const from = cellOf.get(id) ?? spaceKey
      const together = ids.every((one) => cellOf.get(one) === from)
      held = {
        id,
        fx: (grabbed.x - pose.x) / Math.max(pose.w, 1),
        fy: (grabbed.y - pose.y) / Math.max(pose.h, 1),
        box: null,
        landing: null,
        from,
        goes:
          together && !pressed.whole && tabs.length
            ? spacesFor(tabs.map(movingOf), workspace, canWriteAt, mayCarry).map((one) => one.id)
            : [],
        with: ids.slice(1).flatMap((one) => {
          const slot = resting.find((lying) => lying.id === one)
          return slot && first
            ? [{ id: one, dx: slot.x - first.x, dy: slot.y - first.y, w: slot.w, h: slot.h }]
            : []
        }),
        whole: pressed.whole,
      }
      at = id
    }
    hand = toCanvas(camera, { x: event.clientX, y: event.clientY })
    const own = resting.find((one) => one.id === id)
    const w = own?.w ?? 1
    const h = own?.h ?? 1
    const box = { x: hand.x - held.fx * w, y: hand.y - held.fy * h, w, h }
    held = { ...held, box, landing: landingFor(hand) }
    pushAside()
    for (const one of heldIds) follow(one)
    fly()
  }

  function landingFor(point: Point): (Landing & { kind: 'space' }) | null {
    if (!held || held.whole) return null
    const from = held.from
    const goes = held.goes
    const now = held.landing?.key ?? from
    const cells = cellBoxes.filter((one) => one.key === from || goes.includes(one.key))
    const cell = all ? cellAt(cells, now, point.x, point.y, camera.zoom) : from
    return cell === from ? null : { kind: 'space', key: cell }
  }

  function pushedNow(): { key: string; boxes: Box[] } | null {
    if (!held) return null
    const boxes = [...heldIds].flatMap((id) => {
      const pose = flights.get(id)?.pose
      return pose ? [captioned({ x: pose.x, y: pose.y, w: pose.w, h: pose.h })] : []
    })
    return { key: held.landing?.key ?? held.from, boxes }
  }

  let hand: Point = { x: 0, y: 0 }

  function follow(id: string) {
    const box = heldBoxes.get(id)
    const flight = flights.get(id)
    if (!box || !flight) return
    flight.hold(box.x, box.y, box.w, box.h)
    paint(id)
  }

  function up(event: PointerEvent) {
    if (pressed?.pointer !== event.pointerId) return
    pressed = null
    const hand = held
    if (!hand) return
    dragged = true
    const before = places.windows
    const lying = laid.slots
    const pushed = Object.entries(aside)
    aside = {}
    for (const [key, by] of pushed) {
      const place = places.at(key)
      if (place) places.arrange({ [key]: { ...place, x: place.x + by.x, y: place.y + by.y } })
    }
    const box = hand.box
    const was = resting.find((one) => one.id === hand.id)
    const ids = [hand.id, ...hand.with.map((one) => one.id)]
    held = null
    if (box) {
      places.keepWindows(Object.fromEntries(lying.map((one) => [one.id, one])), workspace.tabs)
    }
    if (hand.whole) {
      const place = places.at(hand.whole)
      if (box && was && place)
        places.arrange({
          [hand.whole]: { ...place, x: place.x + box.x - was.x, y: place.y + box.y - was.y },
        })
      void settleApart(hand.whole, true)
    } else if (hand.landing) void carry(ids, hand.landing, before)
    else if (box) {
      void settleApart(hand.from, false)
      const own = lying.filter((one) => cellOf.get(one.id) === spaceKey)
      const strip = ids.every((one) => cellOf.get(one) === spaceKey)
        ? stripLanding(own, hand.id, box)
        : null
      const order = own
        .filter((one) => ids.includes(one.id))
        .sort(readsBefore)
        .map((one) => one.id)
      if (strip)
        for (const id of order)
          drop([id], { kind: 'strip', paneId: strip.paneId, before: strip.before })
    }
    aimAll()
  }

  async function settleApart(key: string, itself: boolean) {
    await laidOut()
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read here and thrown away
    const outlines = new Map(
      cellBoxes.flatMap((one) => {
        const outline = outlineAt(one.key)
        return outline ? [[one.key, outline] as const] : []
      }),
    )
    const mine = outlines.get(key)
    if (!mine) return
    const movers = itself
      ? [key]
      : [...outlines]
          .filter(([other, one]) => other !== key && meets(one, mine, CELLS_APART))
          .map(([other]) => other)
    for (const mover of movers) {
      const outline = outlines.get(mover)
      if (!outline) continue
      const others = [...outlines].filter(([other]) => other !== mover).map(([, one]) => one)
      if (!others.some((one) => meets(one, outline, CELLS_APART))) continue
      const box = boundsOf(outline)
      const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
      const spot = packed([{ key: mover, outline }], CELLS_APART, others, middle)[mover]
      if (!spot) continue
      shiftSpace(mover, spot.x, spot.y)
      outlines.set(mover, shifted(outline, spot.x, spot.y))
    }
  }

  function shiftSpace(key: string, dx: number, dy: number) {
    const own = resting.filter((one) => cellOf.get(one.id) === key)
    places.keepWindows(
      Object.fromEntries(own.map((one) => [one.id, { ...one, x: one.x + dx, y: one.y + dy }])),
      workspace.tabs,
    )
    const place = places.at(key)
    if (place) places.arrange({ [key]: { ...place, x: place.x + dx, y: place.y + dy } })
  }

  function cancelled() {
    pressed = null
    held = null
    aside = {}
    aimAll()
  }

  async function carry(
    ids: readonly string[],
    landing: Landing & { kind: 'space' },
    before: Readonly<Record<string, Box>>,
  ) {
    const asks = ids.some((id) => {
      const tab = byId.get(id)
      return !!tab && TAB_KINDS[tab.kind].asksToMove
    })
    if (asks) {
      for (const id of ids) {
        const box = before[id]
        if (box) places.keepWindows({ [id]: box }, workspace.tabs)
        else places.forgetWindow(id, workspace.tabs)
      }
      const space = workspace.spaces.find((one) => one.id === landing.key)?.name ?? ''
      const sure = await prompt.confirm({
        title: t('Move to {space}?', { space }),
        confirmLabel: key('Move'),
      })
      if (!sure) return
    }
    drop(ids, landing)
  }

  function drop(ids: readonly string[], landing: Landing) {
    if (landing.kind === 'space') {
      void import('../workspace/moving-space')
        .then((one) => one.moveToSpace(ids, landing.key))
        .then((went) => {
          if (!went) for (const one of ids) places.forgetWindow(one, workspace.tabs)
        })
      return
    }
    const id = ids[0]
    if (!id) return
    const strip = tabsOf(landing.paneId)
    const back = strip.filter((one) => one !== id)
    const into = landing.before === null ? back.length : back.indexOf(landing.before)
    if (strip.indexOf(id) === into && byId.get(id)?.paneId === landing.paneId) return

    const held = workspace.heldIn(landing.paneId).filter((one) => one.id !== id)
    const before = landing.before === null ? -1 : held.findIndex((one) => one.id === landing.before)
    const fronts = workspace.panes.all.map((one) => [one.id, one.activeTabId] as const)
    const working = workspace.activeTabId
    workspace.moveTab(id, landing.paneId, before < 0 ? held.length : before)
    const paneOf = (tab: string | null) => workspace.tabs.find((one) => one.id === tab)?.paneId
    for (const [pane, front] of fronts)
      if (front && paneOf(front) === pane) workspace.panes.activate(pane, front)
    if (working && paneOf(working)) workspace.activate(working)
  }

  function keyed(event: KeyboardEvent) {
    if (overlays.depth > layers) return
    const undo = shortcuts.pressed('edit.undo', event)
    if (
      undo ||
      shortcuts.pressed('edit.redo', event) ||
      shortcuts.pressed('edit.redo.alt', event)
    ) {
      event.preventDefault()
      void (undo ? workspace.undoFileAction() : workspace.redoFileAction())
      return
    }
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
    unmoved = false
    camera = showing(camera, next.slot, screenRoom)
    elements.get(next.tab.id)?.window.focus({ preventScroll: true })
  }

  const spaces = $derived(workspace.shownSpaces)

  let zoomGoal: { zoom: number; at: Point; ease: number } | null = null
  let zoomFrame = 0
  let zoomLast = 0

  function zooming(now: number) {
    const goal = zoomGoal
    if (!goal) return (zoomFrame = 0)
    camera = eased(
      camera,
      goal.zoom,
      goal.at,
      Math.min(1 / 30, Math.max(0, (now - zoomLast) / 1000)),
      goal.ease,
    )
    zoomLast = now
    if (camera.zoom === goal.zoom) {
      zoomGoal = null
      zoomFrame = 0
    } else zoomFrame = requestAnimationFrame(zooming)
  }

  function wheeled(node: HTMLElement) {
    const turn = (event: WheelEvent) => {
      event.preventDefault()
      const { deltaX, deltaY, deltaMode, ctrlKey, metaKey, clientX, clientY } = event
      const said = { deltaX, deltaY, deltaMode, ctrlKey, metaKey, x: clientX, y: clientY }
      handTakes()
      const goal = aimed(zoomGoal?.zoom ?? camera.zoom, said)
      if (stillness()) {
        camera = zoomedAt(camera, said, goal.zoom / camera.zoom)
        return
      }
      zoomGoal = { ...goal, at: { x: clientX, y: clientY } }
      if (!zoomFrame) {
        zoomLast = performance.now()
        zoomFrame = requestAnimationFrame(zooming)
      }
    }
    node.addEventListener('wheel', turn, { passive: false })
    return {
      destroy() {
        node.removeEventListener('wheel', turn)
      },
    }
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read by the handlers, never rendered
  const touching = new Map<number, Point>()
  let panning = false

  function grounded(event: PointerEvent) {
    if (!(event.target instanceof Element) || !event.target.closest('.floor')) return
    const space = out && event.button === 0 && !touching.size ? nameAt(event) : null
    const first = space ? laid.slots.find((slot) => cellOf.get(slot.id) === space) : null
    if (first) {
      handTakes()
      pressed = {
        id: first.id,
        x: event.clientX,
        y: event.clientY,
        pointer: event.pointerId,
        whole: space,
      }
      dragged = false
      event.target.setPointerCapture(event.pointerId)
      return
    }
    if (space) {
      handTakes()
      carrying = {
        key: space,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moving: false,
      }
      event.target.setPointerCapture(event.pointerId)
      return
    }
    handTakes()
    touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.target.setPointerCapture(event.pointerId)
    panning = touching.size > 1
  }

  function nameAt(point: { clientX: number; clientY: number }): string | null {
    for (const name of document.querySelectorAll<HTMLElement>('[data-space-name]')) {
      const box = name.getBoundingClientRect()
      const { clientX: x, clientY: y } = point
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
        return name.dataset.spaceName ?? null
    }
    return null
  }

  let carrying = $state<{
    key: string
    pointer: number
    x: number
    y: number
    moving: boolean
  } | null>(null)

  function carried(event: PointerEvent) {
    const one = carrying
    if (one?.pointer !== event.pointerId) return
    const dx = event.clientX - one.x
    const dy = event.clientY - one.y
    if (!one.moving && !isDrag(dx, dy)) return
    one.moving = true
    const by = { x: dx / camera.zoom, y: dy / camera.zoom }
    const outline = outlineAt(one.key)
    if (!outline) return
    const others = cellBoxes.flatMap((cell) => {
      const shape = cell.key === one.key ? null : outlineAt(cell.key)
      return shape ? [{ key: cell.key, outline: shape }] : []
    })
    const pushed = pushedAside(shifted(outline, by.x, by.y), others, CELLS_APART, aside)
    aside = { ...pushed, [one.key]: by }
  }

  function setDown(event: PointerEvent) {
    const one = carrying
    if (one?.pointer !== event.pointerId) return
    carrying = null
    const moves = Object.entries(aside)
    aside = {}
    if (!one.moving || event.type !== 'pointerup') return
    for (const [key, by] of moves) {
      const place = places.at(key)
      if (place) places.arrange({ [key]: { ...place, x: place.x + by.x, y: place.y + by.y } })
    }
    void settleApart(one.key, true)
  }

  function dragging(event: PointerEvent) {
    if (carrying) return carried(event)
    if (pressed?.whole && pressed.pointer === event.pointerId) return moved(event)
    if (!touching.size && event.buttons === 0 && event.target instanceof HTMLElement) {
      const floor = event.target.closest<HTMLElement>('.floor')
      if (floor) floor.style.cursor = all && nameAt(event) ? 'grab' : ''
    }
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
    if (carrying) return setDown(event)
    if (pressed?.whole && pressed.pointer === event.pointerId) {
      if (event.type === 'pointerup') up(event)
      else cancelled()
      return
    }
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
  onfocusin={keptFromBehind}
  onfocusout={() => setTimeout(keysLost, 0)}
  onkeydown={(event: KeyboardEvent) => {
    if (shown && tabOverview.open && event.target === document.body) keyed(event)
  }}
/>

{#if shown}
  {#if modes.overviewBlur}
    <div class="orden-scrim ground is-blurred" aria-hidden="true" bind:this={ground}></div>
  {/if}

  <div
    class="under"
    aria-hidden="true"
    bind:this={under}
    onselectstart={(event) => event.preventDefault()}
    ondragstart={(event) => event.preventDefault()}
  >
    <div
      class="world"
      style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
      style:--overview-line={1 / camera.zoom}
      style:--overview-names={Math.min(unzoom, NAMES_MOST)}
      style:--overview-space-names={Math.min(unzoom, SPACE_NAMES_MOST)}
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
          style:width="calc({slot.w}px / var(--overview-names))"
          use:named={tab.id}
        >
          <TabMark {tab} /><span class="caption-name">{tab.shown}</span>
        </span>
      {/each}
    </div>
  </div>

  <div
    class="canvas"
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
    <div class="floor" style:top="{barBottom}px" aria-hidden="true"></div>

    <div class="top" style:--overview-top="{barBottom > 0 ? barBottom : ROW}px" bind:this={top}>
      {#if spaces.length > 1}
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
      <button class="orden-button is-quiet tidy" type="button" onclick={() => void tidy()}
        >{t('Tidy up')}</button
      >
    </div>

    {#each windows as { slot, tab } (tab.id)}
      {@const face = faceOf(slot)}
      <button
        class="window"
        class:is-at={at === tab.id}
        class:unsaved={isDraft(tab.note)}
        style:width="{slot.w}px"
        style:height="{slot.h}px"
        aria-label={tab.shown}
        aria-current={tab.id === workspace.activeTabId ? 'page' : undefined}
        class:is-front={tab.id === workspace.activeTabId}
        class:is-held={heldIds.has(tab.id)}
        class:is-chosen={chosen.includes(tab.id)}
        aria-pressed={chosen.length ? chosen.includes(tab.id) : undefined}
        onfocus={() => (at = tab.id)}
        onclick={(event) => clicked(event, tab)}
        onpointerdown={(event) => down(event, tab.id)}
        onpointermove={moved}
        onpointerup={up}
        onpointercancel={cancelled}
        use:placed={tab.id}
      >
        <span class="face-box" style:scale={slot.w / face.w}>
          {#if !asPanes[tab.id] || workspace.panes.at(tab.paneId)?.activeTabId !== tab.id}
            <WindowFace
              {tab}
              face={faces.of(tab.id)}
              width={face.w}
              height={face.h}
              drawing={readying}
              flying={onTheWay}
            />
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
        <span class="ring" style:--overview-line={1 / camera.zoom} aria-hidden="true"></span>
      </button>
      <button
        class="closer"
        class:is-front={tab.id === workspace.activeTabId}
        class:is-held={heldIds.has(tab.id)}
        type="button"
        tabindex="-1"
        title={t('Close')}
        aria-label={t('Close')}
        onpointerdown={(event) => event.stopPropagation()}
        onclick={(event) => shut(event, tab)}
        use:closing={tab.id}
      >
        <Cross />
      </button>
      {#if ridersDrawn[tab.id]}
        <span
          class="rider"
          class:is-front={tab.id === workspace.activeTabId}
          aria-hidden="true"
          use:riding={tab.id}
        ></span>
      {/if}
    {/each}
  </div>
  {#if !__EVEN_PLUGIN__ && out && !onTheWay}
    {#await import('./Offstage.svelte') then Offstage}
      <Offstage.default
        tabs={windows.flatMap(({ tab }) => (asPanes[tab.id] ? [] : [tab]))}
        width={stageSize.w}
        height={stageSize.h}
      />
    {/await}
  {/if}
{/if}

<style>
  @property --overview-slide {
    syntax: '<number>';
    inherits: false;
    initial-value: 0;
  }

  @property --overview-bar {
    syntax: '<number>';
    inherits: false;
    initial-value: 0;
  }

  @property --overview-lift {
    syntax: '<number>';
    inherits: false;
    initial-value: 1;
  }

  :global(html[data-overview='slide'] [data-chrome='start']) {
    translate: calc(var(--dir, 1) * -100% * var(--overview-slide, 0)) 0;
  }

  :global(html[data-overview='slide'] [data-chrome='end']) {
    translate: calc(var(--dir, 1) * 100% * var(--overview-slide, 0)) 0;
  }

  :global(
    html[data-overview]
      :is(header[data-chrome='top'] :is(button, [role='button']), [data-side-toggle]):not(
        [data-overview-keeps],
        [data-overview-keeps] *,
        [data-box] *
      )
  ) {
    opacity: calc(1 - var(--overview-open, 1));
    pointer-events: none;
  }

  .ground.is-blurred {
    --scrim-z: var(--z-raised);
    opacity: 0;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    -webkit-backdrop-filter: blur(28px);
    backdrop-filter: blur(28px);
  }

  .canvas {
    --overview-caption: var(--text-base);
    --overview-cell-name: calc(var(--text-base) * 1.6);
    position: static;
    width: 0;
    height: 0;
    outline: none;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .floor {
    position: fixed;
    inset: 0;
    z-index: var(--z-raised);
  }

  .top {
    position: fixed;
    z-index: var(--z-bar);
    top: calc(var(--overview-top, 0px) / 2);
    left: 50%;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    translate: -50% calc(-50% + (1 - var(--overview-open, 0)) * -8px);
    opacity: var(--overview-open, 0);
  }

  .tidy {
    white-space: nowrap;
  }

  .under {
    --overview-caption: var(--text-base);
    --overview-cell-name: calc(var(--text-base) * 1.6);
    position: fixed;
    inset: 0;
    z-index: var(--z-raised);
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }

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
    stroke-width: calc(2.5px * var(--overview-line, 1));
    stroke-linecap: round;
    stroke-dasharray: none;
  }

  .window {
    position: fixed;
    top: 0;
    left: 0;
    padding: 0;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: start;
    overflow: hidden;
    transform-origin: 0 0;
    background: none;
    box-shadow: 0 calc(24px * var(--overview-lift, 1)) calc(64px * var(--overview-lift, 1))
      calc(-12px * var(--overview-lift, 1)) rgb(0 0 0 / 0.26);
    cursor: pointer;
    outline: none;
    touch-action: none;
    pointer-events: auto;
  }

  :global(html[data-overview] header[data-chrome='top']) {
    z-index: var(--z-bar);
  }

  .window,
  .closer,
  .rider {
    z-index: var(--z-popover);
  }

  .window.is-front,
  .closer.is-front,
  .rider.is-front {
    z-index: var(--z-float);
  }

  .window.is-held,
  .closer.is-held {
    z-index: calc(var(--z-bar) - 1);
  }

  .window.is-held {
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

  .ring {
    --ring: 1.5px;
    position: absolute;
    inset: 0;
    opacity: var(--overview-open, 1);
    border-style: solid;
    border-color: color-mix(in srgb, var(--line) 80%, transparent);
    border-width: calc(var(--ring) * var(--overview-line, 1) * var(--flight-y, 1))
      calc(var(--ring) * var(--overview-line, 1) * var(--flight-x, 1));
    border-radius: inherit;
    pointer-events: none;
  }

  .window.unsaved .ring {
    --ring: 2px;
    border-style: dashed;
    border-color: color-mix(in srgb, var(--muted) 75%, transparent);
  }

  .window:hover .ring {
    border-color: var(--line-strong);
  }

  .window.is-chosen .ring {
    --ring: 3px;
    border-style: solid;
    border-color: var(--accent);
  }

  .window.is-at:focus-visible .ring {
    --ring: 2.5px;
    border-style: solid;
    border-color: var(--accent);
  }

  .rider {
    position: fixed;
    top: 0;
    left: 0;
    opacity: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .closer {
    --closer-size: 22px;
    position: fixed;
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
    background: var(--surface-2);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.22);
    transform-origin: 0 0;
    transform: scale(1) translate(-50%, -50%);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .closer :global(.orden-cross) {
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
    scale: var(--overview-names);
  }
</style>
