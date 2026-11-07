<script lang="ts">
  import { untrack } from 'svelte'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasEdges from './CanvasEdges.svelte'
  import CanvasFind from './CanvasFind.svelte'
  import CanvasHands from './CanvasHands.svelte'
  import CanvasInk from './CanvasInk.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import CanvasPicked from './CanvasPicked.svelte'
  import CanvasFar from './CanvasFar.svelte'
  import {
    ctrlWheelZoom,
    graphPoint,
    heldGestures,
    panned,
    pinching,
    screenPoint,
    settledTurn,
    snapped,
    turned,
    turnOf,
    unsnapped,
    zoomed,
  } from './camera'
  import { actualSize, canvasMenu, place, pull, run } from './canvas/actions'
  import {
    coloured,
    movedBy,
    pickedBox,
    resizedPick,
    sized,
    subset,
    turnedInk,
    withText,
  } from './canvas/edits'
  import {
    type Canvas as Plane,
    type InkPoint,
    readCanvas,
    type Shape,
    writeCanvas,
  } from './canvas/format'
  import {
    type Box,
    boxOf,
    caught,
    edgeEnds,
    edgeMiddle,
    GRID,
    HANDLES,
    isLineShape,
    nodeAt,
    overlaps,
    type Point,
    rectBetween,
    shapePath,
  } from './canvas/geometry'
  import { Contacts, hovering, penKind, Stylus } from './canvas/contacts'
  import { cursorFor, type Over } from './canvas/cursor'
  import { hand } from './canvas/hand.svelte'
  import { aimed, fading, latticeLayers, latticeLevel, settled, stepped } from './canvas/lattice'
  import { drawnWidth, pens, shownWidth } from './canvas/pens.svelte'
  import { hitAt, HANDLE, PORT, roomFor } from './canvas/hit'
  import { assisted, leadPoint, penFelt, tidyShape, transformed } from './canvas/ink'
  import { inkColour } from './canvas/paint'
  import { readPalette } from './canvas/palette'
  import {
    drives,
    type Effect,
    type Hit,
    type Input,
    type Machine,
    NOTHING,
    puts,
    start,
    step,
  } from './canvas/pointer'
  import { NO_SNAP, snapMove, snapPoint, snapResize } from './canvas/snap'
  import { Trace } from './canvas/trace'
  import { isPicture } from './canvas/render'
  import { facingSide, SIDES, sidePoint } from './canvas/geometry'
  import { CanvasStore } from './canvas/store.svelte'
  import { tools } from './canvas/tools.svelte'
  import {
    carriedFiles,
    carriesFiles,
    dragged as draggedPaths,
    dropOver,
    isTreeDrag,
  } from './drag-paths'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { followNote } from './open-link'
  import { dur, fade } from './motion'
  import { rooms } from './rooms.svelte'
  import { canWriteIn, trustsHtmlIn } from './sharing.svelte'
  import { pastesMarkup } from './trust'
  import { shortcuts } from './shortcuts.svelte'
  import { modes } from './modes.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  const store = untrack(() => new CanvasStore(tab))

  const SLACK = 800

  const QUANTUM = 400

  const FAR_SCALE = 0.35
  const MOST_CARDS = 300
  const MADE_A_FRAME = 60

  const HELD = 480

  const STILL: Point = { x: 0, y: 0 }

  const ROOM = 72

  const CARD_MARGIN = 24

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let machine = $state.raw<Machine>(start())
  let touchUpAt = 0
  let touchMultiTapAt = 0
  let palette = $state.raw<Record<string, string>>({})
  let placed = $state(false)
  let at: Point = { x: 0, y: 0 }
  let pointing = $state.raw<Point | null>(null)
  let narrowed = $state(false)
  let finding = $state(false)

  const camera = $derived(store.camera)
  const unit = $derived(1 / camera.scale)

  const turn = $derived(turnOf(camera))

  const spanX = $derived(turn ? Math.ceil(Math.hypot(width, height)) : width)
  const spanY = $derived(turn ? spanX : height)

  const originX = $derived(spanX / 2 - camera.x * camera.scale)
  const originY = $derived(spanY / 2 - camera.y * camera.scale)

  let twisted = 0
  let twistedTo = 0

  function twist(x: number, y: number, by: number) {
    if (!modes.canvasTurnSnaps) {
      store.camera = turned(camera, width, height, x, y, by)
      return
    }
    if (turn !== twistedTo) twisted = unsnapped(turn)
    twisted = settledTurn(twisted + by)
    store.camera = turned(camera, width, height, x, y, snapped(twisted) - turn)
    twistedTo = turnOf(store.camera)
  }

  const onScreen = (point: { x: number; y: number }) => screenPoint(camera, width, height, point)

  function screenBox(box: { x: number; y: number; width: number; height: number }) {
    const corners = [
      onScreen(box),
      onScreen({ x: box.x + box.width, y: box.y }),
      onScreen({ x: box.x, y: box.y + box.height }),
      onScreen({ x: box.x + box.width, y: box.y + box.height }),
    ]
    const xs = corners.map((one) => one.x)
    const ys = corners.map((one) => one.y)
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    }
  }

  const THINNING = 210

  let crossing = untrack(() => settled(latticeLevel(camera.scale)))
  let stands = $state(crossing.at)
  let thinning = 0
  let thinnedAt = 0

  const patterns = $derived(latticeLayers(stands, camera.scale))

  $effect(() => {
    const want = latticeLevel(camera.scale, crossing.to)
    if (want === crossing.to) return

    crossing = aimed(crossing, want)

    if (!dur(THINNING)) {
      crossing = settled(want)
      stands = crossing.at
      return
    }

    const frame = (now: number) => {
      const dt = thinnedAt ? now - thinnedAt : 16
      thinnedAt = now

      crossing = stepped(crossing, dt, dur(THINNING))
      stands = crossing.at
      thinning = fading(crossing) ? requestAnimationFrame(frame) : 0
    }

    if (thinning) return

    thinnedAt = 0
    thinning = requestAnimationFrame(frame)
  })

  $effect(() => () => cancelAnimationFrame(thinning))

  const gesture = $derived(machine.gesture)
  const drag = $derived(gesture?.kind === 'drag' ? gesture : null)
  const sizing = $derived(gesture?.kind === 'resize' ? gesture : null)
  const inking = $derived(gesture?.kind === 'ink' ? gesture : null)
  const pulling = $derived(gesture?.kind === 'pull' ? gesture : null)
  const rewiring = $derived(gesture?.kind === 'reconnect' ? gesture : null)

  function bystanders(ids: readonly string[]) {
    const moving = new Set(ids)
    return store.canvas.nodes.filter((node) => !moving.has(node.id)).map(boxOf)
  }

  const dragSnap = $derived.by(() => {
    if (!drag) return NO_SNAP

    const box = pickedBox(store.canvas, drag.ids)
    if (!box) return NO_SNAP

    const snap = snapMove(
      { ...box, x: box.x + drag.dx, y: box.y + drag.dy },
      bystanders(drag.ids),
      GRID / 2,
    )

    return { dx: drag.dx + snap.dx, dy: drag.dy + snap.dy, guides: snap.guides }
  })

  const sizeSnap = $derived.by(() => {
    if (!sizing) return NO_SNAP

    const box = pickedBox(store.canvas, sizing.ids)
    if (!box) return NO_SNAP

    const now = {
      x: box.x + (sizing.handle.includes('w') ? sizing.dx : 0),
      y: box.y + (sizing.handle.includes('n') ? sizing.dy : 0),
      width: box.width + (sizing.handle.includes('e') ? sizing.dx : 0),
      height: box.height + (sizing.handle.includes('s') ? sizing.dy : 0),
    }

    if (sizing.aspect) return { dx: sizing.dx, dy: sizing.dy, guides: [] }

    const snap = snapResize(now, sizing.handle, bystanders(sizing.ids), GRID / 2)
    return { dx: sizing.dx + snap.dx, dy: sizing.dy + snap.dy, guides: snap.guides }
  })

  const JOINS = new Set(['line', 'arrow', 'elbow'])

  const joining = $derived.by(() => {
    if (!pulling?.fromNode || !JOINS.has(pulling.tool)) return null

    const found = hitFor(pulling.to, false)
    if (!found.node || found.node === pulling.fromNode) return null

    const node = shown.nodes.find((one) => one.id === found.node)
    if (!node) return null

    const from = shown.nodes.find((one) => one.id === pulling.fromNode)
    const side = facingSide(boxOf(node), { ...pulling.from, width: 0, height: 0 })
    const leaves = from
      ? sidePoint(boxOf(from), facingSide(boxOf(from), boxOf(node)))
      : pulling.from

    return { id: node.id, side, at: sidePoint(boxOf(node), side), leaves }
  })

  const pullSnap = $derived.by(() => {
    if (!pulling) return NO_SNAP
    if (joining) return NO_SNAP

    return snapPoint(pulling.to, store.canvas.nodes.map(boxOf), GRID / 2)
  })

  const pullTo = $derived.by(() => {
    if (!pulling) return null
    if (joining) return joining.at

    return { x: pulling.to.x + pullSnap.dx, y: pulling.to.y + pullSnap.dy }
  })

  const rewiredTo = $derived.by(() => {
    if (!rewiring) return null

    const found = hitFor(rewiring.to, false)
    const node = found.node ? shown.nodes.find((one) => one.id === found.node) : null
    if (!node) return { at: rewiring.to, onto: null }

    const other = shown.edges.find((one) => one.id === rewiring.edge)
    const far = other && (rewiring.end === 'from' ? other.toNode : other.fromNode)
    const anchor = shown.nodes.find((one) => one.id === far)
    const side = anchor ? facingSide(boxOf(node), boxOf(anchor)) : 'top'

    return { at: sidePoint(boxOf(node), side), onto: node.id }
  })

  let carriedInk = $state.raw<{
    dx: number
    dy: number
    scale: number
    turn: number
    about: Point
  }>({
    dx: 0,
    dy: 0,
    scale: 1,
    turn: 0,
    about: STILL,
  })

  const shown = $derived.by((): Plane => {
    const base = store.canvas
    if (drag) return movedBy(base, drag.ids, dragSnap.dx, dragSnap.dy)
    if (sizing) {
      return resizedPick(base, sizing.ids, sizing.handle, sizeSnap.dx, sizeSnap.dy, sizing.aspect)
    }

    if (inking) {
      const moved = { ...carriedInk, sx: carriedInk.scale, sy: carriedInk.scale }
      const wanted = new Set(store.picked)
      return {
        ...base,
        ink: base.ink.map((stroke) =>
          wanted.has(stroke.id) ? transformed(stroke, moved) : stroke,
        ),
      }
    }

    return base
  })

  const roughX = $derived(Math.round(camera.x / QUANTUM))
  const roughY = $derived(Math.round(camera.y / QUANTUM))
  const roughZoom = $derived(Math.round(Math.log2(camera.scale) * 4))

  const inView = $derived.by(() => {
    const scale = 2 ** (roughZoom / 4)
    const across = spanX / scale + 2 * SLACK
    const down = spanY / scale + 2 * SLACK

    return {
      x: roughX * QUANTUM - across / 2,
      y: roughY * QUANTUM - down / 2,
      width: across,
      height: down,
    }
  })

  const cards = $derived(shown.nodes.filter((node) => overlaps(boxOf(node), inView)))

  const watched = $derived.by(() => {
    const across = spanX / camera.scale / 2
    const down = spanY / camera.scale / 2
    return { x: camera.x - across, y: camera.y - down, width: across * 2, height: down * 2 }
  })

  const far = $derived(
    camera.scale < FAR_SCALE ||
      cards.length > MOST_CARDS ||
      (!placed && !store.framed && shown.nodes.length > MOST_CARDS),
  )

  const wanted = $derived(far ? cards.filter((node) => node.id === store.editing) : cards)

  const onPage = $derived.by(() => {
    const scale = 2 ** (roughZoom / 4)
    const across = spanX / scale + 2 * QUANTUM
    const down = spanY / scale + 2 * QUANTUM
    return {
      x: roughX * QUANTUM - across / 2,
      y: roughY * QUANTUM - down / 2,
      width: across,
      height: down,
    }
  })

  let madeAround = $state.raw<ReadonlySet<string>>(new Set())

  const drawnCards = $derived.by(() => {
    const waiting = wanted.filter(
      (node) => !madeAround.has(node.id) && !overlaps(boxOf(node), onPage),
    )
    if (waiting.length <= MADE_A_FRAME) return wanted
    const late = new Set(waiting.map((node) => node.id))
    return wanted.filter((node) => !late.has(node.id))
  })

  $effect(() => {
    const all = wanted
    const made = madeAround
    const waiting = all.filter((node) => !made.has(node.id) && !overlaps(boxOf(node), onPage))
    if (waiting.length <= MADE_A_FRAME) return
    const frame = requestAnimationFrame(() => {
      const still = new Set(all.map((node) => node.id))
      madeAround = new Set([
        ...[...made].filter((id) => still.has(id)),
        ...waiting.slice(0, MADE_A_FRAME).map((node) => node.id),
      ])
    })
    return () => cancelAnimationFrame(frame)
  })

  const drawnEdges = $derived.by(() => {
    if (far) return []
    const near = new Set(cards.map((node) => node.id))
    return shown.edges.filter((edge) => near.has(edge.fromNode) || near.has(edge.toNode))
  })

  const picked = $derived(store.pickedSet)

  const holdsShape = $derived(
    viewport.touch &&
      store.picked.length > 0 &&
      store.picked.every((id) => {
        const node = store.canvas.nodes.find((one) => one.id === id)
        return node?.type === 'file' && isPicture(node.file)
      }),
  )

  const box = $derived(pickedBox(shown, store.picked))

  const inked = $derived(new Set(store.canvas.ink.map((stroke) => stroke.id)))

  const describes = $derived(
    t('Canvas: {cards} cards, {links} links, {drawings} drawings', {
      cards: store.canvas.nodes.length,
      links: store.canvas.edges.length,
      drawings: store.canvas.ink.length,
    }),
  )

  const lassoed = $derived(store.picked.length > 0 && store.picked.every((id) => inked.has(id)))

  const ported = $derived.by(() => {
    if (gesture || store.editing !== null || tools.which !== 'select') return null
    const under = machine.hovered
    const node = under === null ? undefined : shown.nodes.find((one) => one.id === under)
    if (!node || !roomFor(boxOf(node), camera.scale, PORT)) return null
    return node.id
  })

  const portedBox = $derived(shown.nodes.find((node) => node.id === ported) ?? null)

  const drawing = $derived.by(() => {
    if (gesture?.kind !== 'connect') return null

    const from = shown.nodes.find((node) => node.id === gesture.id)
    if (!from) return null

    return { from: sidePoint(boxOf(from), gesture.side), to: gesture.to, side: gesture.side }
  })

  const band = $derived(gesture?.kind === 'band' ? rectBetween(gesture.from, gesture.to) : null)
  const lasso = $derived(gesture?.kind === 'lasso' ? gesture.points : null)

  const pullFrom = $derived(joining?.leaves ?? pulling?.from ?? null)

  const pullBox = $derived(pullFrom && pullTo ? rectBetween(pullFrom, pullTo) : null)

  const PLAIN = new Set(['text', 'words', 'file', 'picture', 'link', 'group', 'rect', 'ellipse'])

  function pulledPath(tool: string, from: Point, to: Point, box: Box): string {
    const line = isLineShape(tool as Shape)
    const points = shapePath({
      id: 'pulling',
      type: 'shape',
      shape: tool as Shape,
      ...box,
      ...(line && (to.y - from.y) * (to.x - from.x) < 0 ? { up: true } : {}),
    })

    const d = `M ${points.map((one) => `${Math.round(one.x)} ${Math.round(one.y)}`).join(' L ')}`
    return line ? d : `${d} Z`
  }

  const HEAD = 11

  const pullHead = $derived.by(() => {
    if (pulling?.tool !== 'arrow' || !pullFrom || !pullTo) return null

    const dx = pullTo.x - pullFrom.x
    const dy = pullTo.y - pullFrom.y
    const away = Math.hypot(dx, dy)
    if (away < 1) return null

    return {
      x: pullTo.x,
      y: pullTo.y,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      size: Math.min(HEAD, away / 3),
    }
  })

  const edgeHandles = $derived.by(() => {
    if (gesture) return []

    const out: { key: string; at: Point }[] = []
    const byId = new Map(shown.nodes.map((node) => [node.id, node]))
    for (const edge of shown.edges) {
      if (!store.isPicked(edge.id)) continue

      const from = byId.get(edge.fromNode)
      const to = byId.get(edge.toNode)
      if (!from || !to) continue

      const ends = edgeEnds(edge, boxOf(from), boxOf(to))
      out.push({ key: `${edge.id}:from`, at: ends.from }, { key: `${edge.id}:to`, at: ends.to })
    }

    return out
  })

  let predicted = $state.raw<InkPoint[]>([])

  const live = $derived.by(() => {
    if (gesture?.kind !== 'draw') return null

    return {
      id: 'live',
      tool: gesture.stroke.tool,
      color: gesture.stroke.color,
      size: gesture.stroke.size,
      points: [...gesture.stroke.points, ...predicted],
    }
  })

  const guides = $derived(
    dragSnap.guides.length
      ? dragSnap.guides
      : sizeSnap.guides.length
        ? sizeSnap.guides
        : pullSnap.guides,
  )

  function modulo(value: number, by: number): number {
    return by > 0 ? ((value % by) + by) % by : 0
  }

  const follows = (_value: unknown) => undefined

  $effect(() => {
    follows(tab.note.revision)
    if (store.follow() && !store.framed && width && height) store.fit(width, height)
  })

  $effect(() => {
    const id = store.editing
    const room = height - viewport.covered
    if (id === null || !viewport.touch || !viewport.typing || room <= 0) return

    untrack(() => {
      const node = store.canvas.nodes.find((one) => one.id === id)
      if (!node) return

      const { top, bottom } = screenBox(node)
      const low = bottom - (room - CARD_MARGIN)
      const high = CARD_MARGIN - top
      const by = low > 0 ? Math.min(low, -high) : high > 0 ? -high : 0
      if (by) store.camera = panned(camera, 0, -by)
    })
  })

  $effect(() => {
    const ink = tools.which === 'draw' || tools.which === 'erase' || tools.which === 'lasso'
    if (ink) untrack(() => (store.editing !== null ? (store.editing = null) : undefined))
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => measure(element))
    watcher.observe(element)
    measure(element)
    palette = readPalette(element)

    return () => watcher.disconnect()
  })

  $effect(() => {
    const element = host
    if (!element || typeof MutationObserver === 'undefined') return

    const watcher = new MutationObserver(() => (palette = readPalette(element)))
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })

    return () => watcher.disconnect()
  })

  $effect(() => {
    store.readOnly = !canWriteIn(tab.note)
  })

  $effect(() => {
    rooms.drawing(tab.note.key, store)
    return () => {
      store.gone()
      rooms.drawing(tab.note.key, null)
    }
  })

  $effect(() => {
    const shared = store.shared
    if (!shared) return

    shared.hand(pointing, live)
  })

  $effect(() => {
    if (focused && store.editing === null && !finding) host?.focus({ preventScroll: true })
  })

  $effect(() => {
    const element = host
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    const unpinch = heldGestures(
      element,
      (at, by) => {
        const rect = element.getBoundingClientRect()
        store.camera = zoomed(
          camera,
          width,
          height,
          at.clientX - rect.left,
          at.clientY - rect.top,
          by,
        )
      },
      (at, by) => {
        if (!modes.canvasTurns) return
        const rect = element.getBoundingClientRect()
        twist(at.clientX - rect.left, at.clientY - rect.top, by)
      },
    )
    return () => {
      element.removeEventListener('wheel', onWheel)
      unpinch()
    }
  })

  function measure(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const was = height
    width = Math.round(rect.width)
    height = Math.round(rect.height)

    if (placed && viewport.touch && was && height !== was) {
      store.camera = panned(camera, 0, -(height - was) / 2)
    }

    if (placed) return
    placed = true

    if (!store.framed) store.fit(width, height)
  }

  function planeAt(event: { clientX: number; clientY: number }): Point {
    const element = host
    if (!element) return { x: 0, y: 0 }

    const rect = element.getBoundingClientRect()
    return graphPoint(camera, width, height, event.clientX - rect.left, event.clientY - rect.top)
  }

  function screenAt(event: { clientX: number; clientY: number }): Point {
    const rect = host?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  function hitFor(point: Point, coarse: boolean): Hit {
    return hitAt(
      {
        canvas: shown,
        picked: store.picked,
        box,
        scale: camera.scale,
        ported,
        coarse,
        lassoed,
      },
      point,
    )
  }

  function sampleOf(event: PointerEvent, began: number): InkPoint {
    const point = planeAt(event)
    return {
      x: point.x,
      y: point.y,
      ...penFelt(event, stylus.traits),
      t: Math.max(0, Math.round(event.timeStamp - began)),
    }
  }

  let began = 0
  let holding = 0
  let held: Point = { x: 0, y: 0 }

  const A_TWITCH = 6

  function waitForHold(point: Point) {
    window.clearTimeout(holding)
    held = point
    holding = window.setTimeout(() => send({ kind: 'held', at: point }), HELD)
  }

  function stopHolding() {
    window.clearTimeout(holding)
    holding = 0
  }

  $effect(() => () => {
    stopHolding()
    stopDoubting()
  })

  function swallowTheNextClick() {
    const stop = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    }

    window.addEventListener('click', stop, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 900)
  }

  let gestures = 0
  let cloning: string | null = null

  function putting() {
    return { colour: tools.colour, path: tab.path }
  }

  function send(input: Input) {
    const preview = shown
    const aiming = pullTo
    const beginning = machine.gesture === null
    if (beginning && input.kind === 'down') tools.used()
    const next = step(machine, input, {
      tool: tools.which,
      picked: store.picked,
      editing: store.editing,
      scale: camera.scale,
      turn,
      turns: modes.canvasTurns,
      inkBox: box,
      pen: { ...tools.ink, size: drawnWidth(tools.ink.size, camera.scale) },
      eraser: pens.eraser,
      lassoBox: pens.box,
      aspect: holdsShape,
      straighten: pens.straighten,
      penSeen: hand.penSeen,
      fingerDraws: hand.fingerDraws,
    })

    if (beginning && next.machine.gesture) gestures += 1

    machine = next.machine
    for (const effect of next.effects) apply(effect, preview, aiming)
  }

  function apply(effect: Effect, preview: Plane, aiming: Point | null) {
    switch (effect.do) {
      case 'pick':
        if (effect.ids.length === 1 && effect.ids[0]) store.pick(effect.ids[0], effect.adding)
        else store.pickAll(effect.ids, effect.adding)
        break
      case 'band':
        store.pickAll([
          ...effect.was,
          ...caught(preview.nodes, rectBetween(effect.from, effect.to)),
        ])
        break
      case 'clear':
        store.clearPicked()
        break
      case 'leave':
        if (store.editing !== null) store.editing = null
        break
      case 'edit':
        if (!store.readOnly) store.editing = effect.id
        break
      case 'move':
      case 'resize':
        store.edit(preview, cloning ?? undefined)
        cloning = null
        break
      case 'ink': {
        carriedInk = {
          dx: effect.dx,
          dy: effect.dy,
          scale: effect.scale,
          turn: effect.turn,
          about: effect.about,
        }
        break
      }
      case 'connect':
        run.connect(store, effect.from, effect.fromSide, effect.to, effect.toSide, effect.head)
        tools.done()
        break
      case 'reconnect':
        run.reattach(store, effect.edge, effect.end, effect.to)
        break
      case 'clone':
        run.leaveCopy(store, `drag:${gestures}`)
        cloning = `drag:${gestures}`
        break
      case 'pull':
        void pull(store, effect.tool, effect.from, aiming ?? effect.to, putting())
        tools.done()
        break
      case 'place':
        void place(store, effect.tool, effect.at, putting())
        tools.done()
        break
      case 'stroke':
        run.stroke(store, effect.stroke)
        predicted = []
        break
      case 'rub':
        run.rub(store, effect.ats, effect.reach, `rub:${gestures}`)
        break
      case 'cut':
        run.cut(store, effect.ats, effect.reach, `rub:${gestures}`)
        break
      case 'unrub':
        store.takeBack(`rub:${gestures}`)
        break
      case 'catch':
        run.lasso(store, effect.lasso, pens.partly, effect.cards ?? false)
        break
      case 'unmenu':
        menu.hide()
        break
      case 'pan':
        store.camera = panned(camera, effect.dx, effect.dy)
        break
      case 'zoom':
        store.camera = zoomed(camera, width, height, effect.at.x, effect.at.y, effect.by)
        break
      case 'turn':
        twist(effect.at.x, effect.at.y, effect.by)
        break
      case 'menu':
        if (holding) swallowTheNextClick()
        stopHolding()
        showMenu(effect.at)
        break
      case 'assist':
        assistShape()
        break
    }
  }

  function assistShape() {
    const one = machine.gesture
    if (one?.kind !== 'draw') return

    const stroke = { id: 'live', ...one.stroke }
    const shape = assisted(stroke)
    if (!shape) return

    machine = {
      ...machine,
      gesture: { ...one, stroke: { ...one.stroke, points: tidyShape(stroke, shape).points } },
    }
    predicted = []
  }

  function kindOf(event: PointerEvent) {
    return penKind(event, { penSeen: hand.penSeen, touch: viewport.touch })
  }

  const contacts = new Contacts()

  const stylus = new Stylus({
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    touch: typeof navigator === 'undefined' ? false : navigator.maxTouchPoints > 0,
    coalesced: typeof PointerEvent === 'function' && 'getCoalescedEvents' in PointerEvent.prototype,
    predicted: typeof PointerEvent === 'function' && 'getPredictedEvents' in PointerEvent.prototype,
  })

  const trace = new Trace()
  let traced = $state('')
  let profile = $state(stylus.line)

  function note(what: string, event: PointerEvent) {
    if (stylus.saw(event)) profile = stylus.line

    if (
      trace.note({
        what,
        kind: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        id: event.pointerId,
      })
    ) {
      traced = trace.line
    }
  }

  let lastPen = false

  const GRACE = 160
  let doubting: { id: number; timer: number } | null = null

  function stopDoubting(id?: number) {
    if (!doubting || (id !== undefined && doubting.id !== id)) return

    window.clearTimeout(doubting.timer)
    doubting = null
  }

  function capture(id: number) {
    try {
      host?.setPointerCapture(id)
    } catch {
      // Nothing to do and nothing to say: the events keep coming, they are simply
      // not promised to this element.
    }
  }

  function onPointerDown(event: PointerEvent) {
    const { kind, eraser } = kindOf(event)
    const pen = kind === 'pen'
    note('down', event)

    if (contacts.echo(event)) return

    lastPen = pen

    if (event.button === 2 && !pen) return

    const point = planeAt(event)
    at = point
    began = event.timeStamp

    const coarse = kind === 'touch'
    contacts.came(event.pointerId, { pen, eraser })

    if (pen) hand.sawPen()
    capture(event.pointerId)

    send({
      kind: 'down',
      id: event.pointerId,
      pointer: kind,
      at: point,
      screen: screenAt(event),
      time: event.timeStamp,
      button: event.button,
      shift: event.shiftKey,
      adds: event.ctrlKey || event.metaKey,
      alt: event.altKey,
      eraser,
      sample: sampleOf(event, began),
      hit: hitFor(point, coarse),
    })

    if (coarse && !machine.penDown) waitForHold(point)
  }

  function repairPen(event: PointerEvent, point: Point) {
    const now = kindOf(event)
    const turned = contacts.turned(event.pointerId, {
      pen: now.kind === 'pen',
      eraser: now.eraser,
    })
    if (!turned) return

    lastPen = true
    if (turned.first) hand.sawPen()
    stopHolding()
    began = event.timeStamp

    send({
      kind: 'penned',
      id: event.pointerId,
      at: point,
      sample: sampleOf(event, began),
      eraser: turned.eraser,
      hit: hitFor(point, false),
    })
  }

  function onPointerMove(event: PointerEvent) {
    note('move', event)

    const floating = hovering(event) || !contacts.has(event.pointerId)

    if (!floating) stopDoubting(event.pointerId)

    const point = planeAt(event)
    at = point
    if (store.shared) pointing = point
    const kind = kindOf(event).kind
    const coarse = kind === 'touch'
    lastPen = kind === 'pen'

    const samples =
      machine.gesture?.kind === 'draw' && !floating
        ? (typeof event.getCoalescedEvents === 'function'
            ? event.getCoalescedEvents()
            : [event]
          ).map((one) => sampleOf(one, began))
        : []

    if (machine.gesture?.kind === 'draw' && !floating) {
      const guessed =
        typeof event.getPredictedEvents === 'function'
          ? event.getPredictedEvents().map((one) => sampleOf(one, began))
          : []
      const laid = machine.gesture.stroke.points
      const nib = samples[samples.length - 1] ?? laid[laid.length - 1]
      const before =
        samples.length > 1
          ? samples[samples.length - 2]
          : laid[laid.length - (samples.length ? 1 : 2)]

      predicted = leadPoint(before, nib, guessed)
    }

    if (!floating) repairPen(event, point)

    if (holding && Math.hypot(point.x - held.x, point.y - held.y) * camera.scale > A_TWITCH) {
      stopHolding()
    }

    const wants =
      !machine.gesture || machine.gesture.kind === 'erase' || machine.gesture.kind === 'pull'
    const found = wants ? hitFor(point, coarse) : NOTHING

    if (!machine.gesture) over = overOf(found)
    rubAt = machine.gesture?.kind === 'erase' ? point : null

    send({
      kind: 'move',
      id: event.pointerId,
      at: point,
      screen: screenAt(event),
      samples,
      hit: found,
    })

    if (machine.gesture?.kind === 'draw' && !holding) waitForHold(point)
  }

  function onPointerUp(event: PointerEvent) {
    note('up', event)
    if (event.pointerType === 'touch') touchUpAt = performance.now()
    stopHolding()
    rubAt = null
    stopDoubting(event.pointerId)
    contacts.went(event.pointerId)
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)

    const point = planeAt(event)
    const wasInk = machine.gesture?.kind === 'ink'

    send({
      kind: 'up',
      id: event.pointerId,
      at: point,
      screen: screenAt(event),
      hit: hitFor(point, event.pointerType === 'touch'),
    })

    if (wasInk) {
      const moved = carriedInk
      carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
      if (moved.dx || moved.dy || moved.scale !== 1 || moved.turn) {
        const wanted = new Set(store.picked)
        const turned = turnedInk(store.canvas, store.picked, moved.turn, moved.about)
        store.edit({
          ...turned,
          ink: turned.ink.map((stroke) =>
            wanted.has(stroke.id)
              ? transformed(stroke, {
                  dx: moved.dx,
                  dy: moved.dy,
                  sx: moved.scale,
                  sy: moved.scale,
                  turn: 0,
                  about: moved.about,
                })
              : stroke,
          ),
        })
      }
    }
  }

  function onPointerCancel(event: PointerEvent) {
    note('cancel', event)
    stopHolding()
    rubAt = null

    const pen = machine.driver?.kind === 'pen' && machine.driver.id === event.pointerId
    if (pen && machine.gesture) {
      stopDoubting()
      const id = event.pointerId
      doubting = {
        id,
        timer: window.setTimeout(() => {
          doubting = null
          contacts.went(id)
          predicted = []
          carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
          send({ kind: 'cancel', id })
        }, GRACE),
      }
      return
    }

    contacts.went(event.pointerId)
    if (drives(machine, event.pointerId)) {
      predicted = []
      carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
    }
    send({ kind: 'cancel', id: event.pointerId })
  }

  function onWheel(event: WheelEvent) {
    const element = host
    if (!element) return

    event.preventDefault()
    const rect = element.getBoundingClientRect()

    if (event.ctrlKey || event.metaKey) {
      if (pinching()) return
      store.camera = zoomed(
        camera,
        width,
        height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        ctrlWheelZoom(event),
      )
      return
    }

    store.camera = panned(camera, -event.deltaX, -event.deltaY)
  }

  function onDoubleClick(event: MouseEvent) {
    if (touchMultiTapAt > 0 && performance.now() - touchMultiTapAt < 300) return
    if (tools.which !== 'select') return

    const point = planeAt(event)
    void run.open(store, hitFor(point, false), point)
  }

  function onTapClick(event: MouseEvent) {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('.cluster, button, input, textarea, [contenteditable="true"]')
    ) {
      return
    }

    const pointerType = 'pointerType' in event ? (event as PointerEvent).pointerType : ''
    const touch = pointerType === 'touch' || performance.now() - touchUpAt < 350
    if (!touch || store.editing !== null) return

    if (event.detail === 2) {
      touchMultiTapAt = performance.now()
      event.preventDefault()
      store.undo()
    } else if (event.detail === 3) {
      touchMultiTapAt = performance.now()
      event.preventDefault()
      store.redo()
    }
  }

  function showMenu(point: Point, about = false, buttons = 0) {
    const found = hitFor(point, viewport.touch)
    if (found.node && !store.isPicked(found.node)) store.pick(found.node)
    if (found.edge && !store.isPicked(found.edge)) store.pick(found.edge)
    if (found.stroke && !store.isPicked(found.stroke)) store.pick(found.stroke)
    const bare =
      !about && !found.node && !found.edge && !found.stroke && !found.ink && !found.handle
    const under = about ? null : nodeAt(shown.nodes, point, 12)

    const rect = host?.getBoundingClientRect()
    const at = onScreen(point)
    const screen = { clientX: (rect?.left ?? 0) + at.x, clientY: (rect?.top ?? 0) + at.y }

    const near = viewport.touch
    menu.show(
      new MouseEvent('contextmenu', { ...screen, buttons }),
      canvasMenu(store, point, {
        bare,
        locked: under?.locked ? under.id : null,
        again: (rows, title) =>
          menu.show(new MouseEvent('contextmenu', screen), rows, { title, near }),
        path: tab.path,
        name: tab.name,
        palette,
        width,
        height,
        narrowed,
        trusted: trustsHtmlIn(tab.note),
        onnarrow: () => {
          narrowed = !narrowed
          if (narrowed) store.frame(width, height)
        },
        onfind: () => (finding = true),
      }),
      { title: t('Canvas'), near },
    )
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
    if (lastPen || (hand.penSeen && viewport.touch)) return

    showMenu(planeAt(event), false, event.buttons)
  }

  function typing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false

    return (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
  }

  function onKeyDown(event: KeyboardEvent) {
    if (typing(event.target)) return

    if (event.key === ' ' && store.editing === null) {
      event.preventDefault()
      send({ kind: 'space', down: true })
      return
    }

    if (event.key === 'Escape') {
      if (store.editing !== null) store.editing = null
      else if (narrowed) narrowed = false
      else if (tools.which !== 'select') tools.choose('select')
      else store.clearPicked()
      return
    }

    if (store.editing !== null) return

    if (
      run.keys(store, event, {
        width,
        height,
        path: tab.path,
        name: tab.name,
        palette,
        onfind: () => (finding = true),
      })
    ) {
      event.preventDefault()
      return
    }

    if (shortcuts.pressed('edit.select-all', event)) {
      event.preventDefault()
      store.pickAll([
        ...store.canvas.nodes.map((node) => node.id),
        ...store.canvas.ink.map((stroke) => stroke.id),
      ])
      return
    }

    if (shortcuts.pressed('edit.undo', event)) {
      event.preventDefault()
      store.undo()
      return
    }

    if (shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)) {
      event.preventDefault()
      store.redo()
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === ' ' && !typing(event.target)) send({ kind: 'space', down: false })
    tools.released(event)
  }

  function onCopy(event: ClipboardEvent) {
    if (typing(event.target) || store.editing !== null || !store.picked.length) return

    event.preventDefault()
    event.clipboardData?.setData('text/plain', writeCanvas(subset(store.canvas, store.picked)))
  }

  function onCut(event: ClipboardEvent) {
    if (typing(event.target) || store.editing !== null || !store.picked.length) return

    onCopy(event)
    run.remove(store)
  }

  function onPaste(event: ClipboardEvent) {
    if (typing(event.target) || store.editing !== null) return

    const picture = [...(event.clipboardData?.items ?? [])].find(
      (one) => one.type.startsWith('image/') || one.type === 'application/pdf',
    )

    if (picture) {
      const file = picture.getAsFile()
      if (file) {
        event.preventDefault()
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          void run.dropPdf(store, file, at, tab.path)
        } else {
          void run.dropImage(store, file, at, tab.path)
        }
        return
      }
    }

    const text = event.clipboardData?.getData('text/plain').trim()
    if (!text) return

    const types = [...(event.clipboardData?.types ?? [])]
    if (pastesMarkup(types, text)) tab.note.pasted = true

    event.preventDefault()
    run.paste(store, readCanvas(text), text, at)
  }

  function onDrop(event: DragEvent) {
    const point = planeAt(event)
    const paths = draggedPaths(event.dataTransfer)

    if (paths.length) {
      event.preventDefault()
      run.dropPaths(store, paths, point)
      return
    }

    const transfer = event.dataTransfer
    const dropped = [...(transfer?.files ?? [])]
    if (!dropped.length && transfer) {
      dropped.push(
        ...[...transfer.items]
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null),
      )
    }
    const reading = dropped.length ? null : carriedFiles.read(transfer ?? null)
    if (reading) {
      event.preventDefault()
      void reading.then((read) => placeFiles(read.filter(isCanvasFile), point))
      return
    }
    const files = dropped.filter(isCanvasFile)
    if (!files.length) return

    event.preventDefault()
    placeFiles(files, point)
  }

  function placeFiles(files: readonly File[], point: { x: number; y: number }) {
    for (const [index, file] of files.entries()) {
      const at = { x: point.x, y: point.y + index * GRID * 10 }
      if (isPdfFile(file)) void run.dropPdf(store, file, at, tab.path)
      else void run.dropImage(store, file, at, tab.path)
    }
  }

  function isCanvasFile(file: File): boolean {
    return file.type.startsWith('image/') || isPicture(file.name) || isPdfFile(file)
  }

  function isPdfFile(file: File): boolean {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  }

  const pickedColour = $derived.by(() => {
    const first = store.picked[0]
    if (!first) return null

    const node = store.canvas.nodes.find((one) => one.id === first)
    return node?.color ?? store.canvas.edges.find((one) => one.id === first)?.color ?? null
  })

  function colourPicked(colour: string | null) {
    store.edit(coloured(store.canvas, store.picked, colour))
    if (colour !== null) tools.colour = colour
  }

  const pickedSpan = $derived.by(() => {
    if (box) return box

    const edge = shown.edges.find((one) => store.isPicked(one.id))
    const from = edge && shown.nodes.find((one) => one.id === edge.fromNode)
    const to = edge && shown.nodes.find((one) => one.id === edge.toNode)
    if (!edge || !from || !to) return null

    const at = edgeMiddle(edgeEnds(edge, boxOf(from), boxOf(to)))
    return { x: at.x, y: at.y, width: 0, height: 0 }
  })

  const overPicked = $derived.by(() => {
    const box = pickedSpan
    if (!box || gesture || store.editing !== null || !store.picked.length) return null

    const seen = screenBox(box)
    const middle = (seen.left + seen.right) / 2
    const above = seen.top
    const under = seen.bottom
    const below = above < ROOM

    return {
      at: {
        x: Math.min(Math.max(middle, ROOM), Math.max(ROOM, width - ROOM)),
        y: below ? under : above,
      },
      below,
    }
  })

  let over = $state.raw<Over>(null)

  let rubAt = $state.raw<Point | null>(null)

  function overOf(found: Hit): Over {
    if (found.handle) return found.handle
    if (found.ink === 'turn') return 'turn'
    if (found.ink === 'inside') return 'thing'
    if (found.ink) return found.ink
    if (found.port || found.endpoint) return 'port'
    if (found.node || found.edge || found.stroke) return 'thing'

    return null
  }

  const inHand = $derived.by(() => {
    const which = tools.which
    if (which === 'hand' || which === 'draw' || which === 'erase' || which === 'lasso') return which
    if (puts(which)) return 'put' as const

    return 'select' as const
  })

  const cursor = $derived.by(() => {
    if (viewport.touch) return undefined

    return cursorFor({
      tool: inHand,
      busy: gesture !== null,
      holding: machine.spacing,
      over,
      nib: {
        size: drawnWidth(pens.current.size, camera.scale) * camera.scale,
        colour: inkColour(pens.current.colour, palette),
      },
      rub: { size: pens.whole ? pens.strokeRub : pens.rub, whole: pens.whole },
    })
  })

  const rubbing = $derived.by(() => {
    if (gesture?.kind !== 'erase' || gesture.whole || !rubAt) return null

    return { at: rubAt, reach: pens.rub / camera.scale }
  })

  const pickedWidth = $derived.by(() => {
    const stroke = store.canvas.ink.find((one) => store.isPicked(one.id))
    return stroke && shownWidth(stroke.size, camera.scale)
  })

  const onFrame = $derived(
    store.canvas.nodes.some((node) => node.type === 'group' && picked.has(node.id)),
  )

  const bare = $derived(
    !store.canvas.nodes.length && !store.canvas.edges.length && !store.canvas.ink.length,
  )
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="canvas orden-host"
  class:narrowed
  style:cursor
  bind:this={host}
  role="application"
  aria-roledescription={t('Canvas')}
  aria-label={describes}
  tabindex="-1"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onpointerleave={() => (pointing = null)}
  onclick={onTapClick}
  ondblclick={onDoubleClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  oncopy={onCopy}
  oncut={onCut}
  onpaste={onPaste}
  oncontextmenu={onContextMenu}
  use:dropOver={(event) => {
    if (isTreeDrag(event.dataTransfer) || carriesFiles(event.dataTransfer)) {
      event.preventDefault()
    }
  }}
  ondrop={onDrop}
>
  <div
    class="turned"
    style:left={turn ? `${(width - spanX) / 2}px` : undefined}
    style:top={turn ? `${(height - spanY) / 2}px` : undefined}
    style:width={turn ? `${spanX}px` : undefined}
    style:height={turn ? `${spanY}px` : undefined}
    style:transform={turn ? `rotate(${turn}rad)` : undefined}
  >
    {#each patterns as level (level.every)}
      <div
        class="dots"
        style:--dot-step="{level.step}px"
        style:opacity={level.showing}
        style:left="{-level.step}px"
        style:top="{-level.step}px"
        style:width="{spanX + 2 * level.step}px"
        style:height="{spanY + 2 * level.step}px"
        style:transform="translate({modulo(originX - level.step / 2, level.step)}px, {modulo(
          originY - level.step / 2,
          level.step,
        )}px)"
      ></div>
    {/each}

    {#if far}
      <CanvasFar
        nodes={shown.nodes}
        edges={shown.edges}
        {picked}
        dimmed={narrowed}
        skip={store.editing}
        view={inView}
        {camera}
        {originX}
        {originY}
        width={spanX}
        height={spanY}
        {palette}
      />
    {/if}

    <div class="plane" style:transform="translate({originX}px, {originY}px) scale({camera.scale})">
      <CanvasEdges
        edges={drawnEdges}
        nodes={shown.nodes}
        picked={store.pickedSet}
        provisional={drawing}
      />

      {#each drawnCards as node (node.id)}
        <CanvasNode
          {node}
          canvasPath={tab.path}
          trusted={trustsHtmlIn(tab.note)}
          root={workspace.rootHolding(tab.path)}
          picked={picked.has(node.id)}
          dimmed={narrowed && !picked.has(node.id)}
          editing={store.editing === node.id}
          readOnly={store.readOnly}
          offset={STILL}
          scale={camera.scale}
          seen={watched}
          ontext={(text: string) => store.edit(withText(store.canvas, node.id, text))}
          onleave={() => (store.editing = null)}
          onfollow={followNote}
        />
      {/each}

      {#if portedBox}
        {@const ported = boxOf(portedBox)}
        {#each SIDES as side (side)}
          {@const point = sidePoint(ported, side)}
          <div
            class="port"
            style:left="{point.x}px"
            style:top="{point.y}px"
            style:width="{PORT * unit}px"
            style:height="{PORT * unit}px"
          ></div>
        {/each}
      {/if}

      {#if box}
        <div
          class="frame"
          style:left="{box.x}px"
          style:top="{box.y}px"
          style:width="{box.width}px"
          style:height="{box.height}px"
          style:border-width="{unit}px"
        ></div>

        {#each roomFor(box, camera.scale, HANDLE) ? HANDLES : [] as handle (handle.id)}
          <div
            class="handle"
            style:left="{box.x + ((handle.x + 1) / 2) * box.width}px"
            style:top="{box.y + ((handle.y + 1) / 2) * box.height}px"
            style:width="{HANDLE * unit}px"
            style:height="{HANDLE * unit}px"
          ></div>
        {/each}

        {#if lassoed}
          <div
            class="turn"
            style:left="{box.x + box.width / 2}px"
            style:top="{box.y - HANDLE * 3.4 * unit}px"
            style:width="{HANDLE * 2 * unit}px"
            style:height="{HANDLE * 2 * unit}px"
          ></div>
        {/if}
      {/if}

      {#if band}
        <div
          class="band"
          style:left="{band.x}px"
          style:top="{band.y}px"
          style:width="{band.width}px"
          style:height="{band.height}px"
        ></div>
      {/if}

      {#if pulling && pullBox && pullTo && pullFrom}
        {#if PLAIN.has(pulling.tool)}
          <div
            class="band pulling"
            class:round={pulling.tool === 'ellipse'}
            class:framed={pulling.tool === 'group'}
            style:left="{pullBox.x}px"
            style:top="{pullBox.y}px"
            style:width="{pullBox.width}px"
            style:height="{pullBox.height}px"
            style:border-width="{Math.max(1, unit)}px"
          ></div>
        {:else}
          <svg class="drawing" aria-hidden="true" width="1" height="1" style:overflow="visible">
            <path
              d={pulledPath(pulling.tool, pullFrom, pullTo, pullBox)}
              style:stroke-width="{2 * unit}px"
              style:stroke-dasharray="{6 * unit}
              {5 * unit}"
            />
            {#if pullHead}
              <path
                class="point"
                d="M 0 0 L {-pullHead.size} {-pullHead.size *
                  0.5} L {-pullHead.size} {pullHead.size * 0.5} Z"
                transform="translate({pullHead.x} {pullHead.y}) rotate({pullHead.angle})"
              />
            {/if}
          </svg>
        {/if}
      {/if}

      {#if joining}
        <div
          class="port aiming"
          style:left="{joining.at.x}px"
          style:top="{joining.at.y}px"
          style:width="{PORT * 1.6 * unit}px"
          style:height="{PORT * 1.6 * unit}px"
        ></div>
      {/if}

      {#if rewiring && rewiredTo}
        <div
          class="port aiming"
          class:loose={rewiredTo.onto === null}
          style:left="{rewiredTo.at.x}px"
          style:top="{rewiredTo.at.y}px"
          style:width="{PORT * 1.6 * unit}px"
          style:height="{PORT * 1.6 * unit}px"
        ></div>
      {/if}

      {#each edgeHandles as end (end.key)}
        <div
          class="handle round"
          style:left="{end.at.x}px"
          style:top="{end.at.y}px"
          style:width="{HANDLE * unit}px"
          style:height="{HANDLE * unit}px"
        ></div>
      {/each}

      {#if rubbing}
        <div
          class="rubbing"
          style:left="{rubbing.at.x}px"
          style:top="{rubbing.at.y}px"
          style:width="{rubbing.reach * 2}px"
          style:height="{rubbing.reach * 2}px"
          style:border-width="{1.5 * unit}px"
        ></div>
      {/if}

      {#each guides as guide, index (index)}
        <div
          class="guide"
          class:down={guide.axis === 'y'}
          style:left="{guide.axis === 'x' ? guide.at : guide.from}px"
          style:top="{guide.axis === 'y' ? guide.at : guide.from}px"
          style:width="{guide.axis === 'x' ? unit : guide.to - guide.from}px"
          style:height="{guide.axis === 'y' ? unit : guide.to - guide.from}px"
        ></div>
      {/each}

      {#if lasso && lasso.length > 1}
        <svg class="lasso" aria-hidden="true" width="1" height="1" style:overflow="visible">
          <path
            d="M {lasso
              .map((point) => `${Math.round(point.x)} ${Math.round(point.y)}`)
              .join(' L ')} Z"
            style:stroke-width="{1.5 * unit}px"
            style:stroke-dasharray="{5 * unit}
            {4 * unit}"
          />
        </svg>
      {/if}

      <CanvasHands
        hands={store.hands}
        {unit}
        {palette}
        {camera}
        width={spanX}
        height={spanY}
        ongo={(at: { x: number; y: number }) => (store.camera = { ...camera, x: at.x, y: at.y })}
      />
    </div>

    <CanvasInk ink={shown.ink} {live} {camera} width={spanX} height={spanY} {picked} {palette} />
  </div>

  {#if bare}
    <p class="hint" transition:fade={{ duration: dur(190) }}>
      {viewport.touch ? t('Double-tap to write') : t('Double-click to write')}
    </p>
  {/if}

  {#if !(viewport.touch && viewport.typing)}
    <CanvasBar
      canundo={store.canUndo}
      canredo={store.canRedo}
      onundo={() => store.undo()}
      onredo={() => store.redo()}
      onerase={() => run.eraseAll(store)}
      scale={camera.scale}
      onactual={() => actualSize(store, { width, height })}
    />
  {/if}

  {#if overPicked}
    <CanvasPicked
      at={overPicked.at}
      below={overPicked.below}
      colour={pickedColour}
      size={pickedWidth}
      recent={pens.recent}
      grouping={onFrame ? 'ungroup' : store.picked.length > 1 ? 'group' : null}
      oncolour={colourPicked}
      onsize={(size: number, drag: string) =>
        store.edit(sized(store.canvas, store.picked, drawnWidth(size, camera.scale)), drag)}
      onduplicate={() => run.duplicate(store)}
      ondelete={() => run.remove(store)}
      ongroup={() => (onFrame ? run.ungroup(store) : run.group(store))}
      onmore={() => {
        if (pickedSpan) showMenu({ x: pickedSpan.x + pickedSpan.width / 2, y: pickedSpan.y }, true)
      }}
    />
  {/if}

  <span class="unseen" data-pointer aria-hidden="true">{profile} // {traced}</span>

  {#if finding}
    <CanvasFind
      canvas={store.canvas}
      onpick={(id: string) => {
        store.pick(id)
        store.frame(width, height)
      }}
      onclose={() => {
        finding = false
        host?.focus({ preventScroll: true })
      }}
    />
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    background: var(--content-inner, var(--bg));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    cursor: default;
  }

  .turned {
    position: absolute;
    inset: 0;
    transform-origin: center;
  }

  .dots {
    position: absolute;
    pointer-events: none;
    background-image: radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px);
    background-size: var(--dot-step) var(--dot-step);
    will-change: transform;
  }

  .plane {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  .port,
  .handle,
  .turn {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
    z-index: var(--z-grip);
  }

  .port {
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--accent);
    opacity: 0.75;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .port:hover {
    opacity: 1;
  }

  .port.aiming {
    background: var(--accent);
    opacity: 1;
    z-index: var(--z-tools);
  }

  .port.aiming.loose {
    background: var(--surface);
    border-style: dashed;
  }

  .handle {
    border-radius: 2px;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  .handle.round {
    border-radius: 50%;
  }

  .rubbing {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
    border-radius: 50%;
    border-style: solid;
    border-color: var(--muted-strong);
    background: color-mix(in srgb, var(--surface) 35%, transparent);
    pointer-events: none;
    z-index: var(--z-tools);
  }

  .turn {
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    border-radius: 3px;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .band {
    position: absolute;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .band.pulling {
    background: none;
    border-style: dashed;
  }

  .band.pulling.round {
    border-radius: 50%;
  }

  .band.pulling.framed {
    border-radius: var(--radius-lg);
  }

  .drawing {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .drawing path {
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .drawing path.point {
    fill: var(--accent);
    stroke: none;
    stroke-dasharray: none;
  }

  .guide {
    position: absolute;
    background: var(--accent);
    opacity: 0.7;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .lasso {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .lasso path {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }

  .hint {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: 0;
    translate: -50% -50%;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    text-align: center;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }

  :global([data-touch]) .hint {
    font-size: var(--touch-text);
  }

  .unseen {
    position: absolute;
    left: -9999px;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    pointer-events: none;
  }
</style>
