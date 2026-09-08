<script lang="ts">
  /** A canvas: an endless plane with cards, shapes, connectors and ink on it, in
   *  a tab like a note.
   *
   *  One transform for the whole plane. The cards are ordinary elements at the
   *  coordinates the file gives them, the connectors are one SVG layer beside
   *  them, the ink is two 2d canvases over both, and panning and zooming move the
   *  plane rather than anything in it - so a pan is a composited transform with
   *  no layout to redo, whether there are five cards or five hundred. Cards far
   *  off screen are left out of the page altogether.
   *
   *  Every gesture goes through the machine in canvas/pointer.ts. This file does
   *  three things and no more: it works out what is under a point, it hands the
   *  machine the event, and it carries out the effects it gets back. What a press
   *  means is not decided here, which is why it can be tested without a browser.
   *
   *  A gesture is one edit. What the plane shows while a gesture is under way is
   *  the same pure function of the canvas that the gesture ends by committing, so
   *  what you let go of is exactly what you saw, and nothing is written or
   *  recorded in between.
   *
   *  Keys. Undo, redo and select all are read off the shortcut registry, so a
   *  reader who rebound them has their own keys here too. The rest mean something
   *  only while a plane is the surface in front, so they are read straight. */

  import { untrack } from 'svelte'
  import type { NoteJump } from '@nib/editor'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasEdges from './CanvasEdges.svelte'
  import CanvasFind from './CanvasFind.svelte'
  import CanvasHands from './CanvasHands.svelte'
  import CanvasInk from './CanvasInk.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import CanvasPens from './CanvasPens.svelte'
  import { graphPoint, zoomed } from './camera'
  import { canvasMenu, place, run } from './canvas/actions'
  import {
    coloured,
    movedBy,
    pickedBox,
    resizedPick,
    subset,
    turnedInk,
    withText,
  } from './canvas/edits'
  import { type Canvas as Plane, type InkPoint, readCanvas, writeCanvas } from './canvas/format'
  import { boxOf, GRID, HANDLES, overlaps, type Point, rectBetween } from './canvas/geometry'
  import { hand } from './canvas/hand.svelte'
  import { pens } from './canvas/pens.svelte'
  import { hitAt, HANDLE, PORT } from './canvas/hit'
  import { assisted, tidyShape, transformed } from './canvas/ink'
  import { DEFAULT_INK, readPalette } from './canvas/palette'
  import {
    type Effect,
    type Hit,
    type Input,
    type Machine,
    NOTHING,
    start,
    step,
  } from './canvas/pointer'
  import { NO_SNAP, snapMove, snapResize } from './canvas/snap'
  import { SIDES, sidePoint } from './canvas/geometry'
  import { CanvasStore } from './canvas/store.svelte'
  import { tools } from './canvas/tools.svelte'
  import { dragged as draggedPaths, isTreeDrag } from './drag-paths'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { rooms } from './rooms.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** The plane this tab is showing. Built once from the tab it was given: the
   *  pane keys this component by tab, so a canvas surface and its tab live and
   *  die together and there is no second tab to follow. */
  const store = untrack(() => new CanvasStore(tab))

  /** How far beyond the edges of the view a card is still drawn, in plane units.
   *  A screenful of slack, so a pan crosses a whole viewport before the set of
   *  cards on the page changes at all. */
  const SLACK = 800

  /** How far the view has to move before which cards are on the page is worked
   *  out again, in plane units.
   *
   *  Without this the answer changes on every frame of a pan, and a new list of
   *  cards means the whole each block is walked and five hundred components are
   *  handed new props sixty times a second. With it a pan is a transform and
   *  nothing else until the view has really moved somewhere new, which is what
   *  keeps a plane of five hundred cards at sixty frames a second. */
  const QUANTUM = 400

  /** Below this the dots are closer together than they are wide, and the grid
   *  stops being a grid and becomes a wash. */
  const DOTS_UNTIL = 7

  /** How long a pointer has to be still before it means something else: the menu
   *  under a finger, a tidied shape under a pen. */
  const HELD = 480

  /** A card that is not being dragged, so the each block below hands over the
   *  same object every frame rather than a fresh zero. */
  const STILL: Point = { x: 0, y: 0 }

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  // Raw: the machine is replaced whole by every event and never changed in
  // place, so there is nothing for a proxy to watch and a great deal for it to
  // wrap. See the note on the canvas in store.svelte.ts.
  let machine = $state.raw<Machine>(start())
  /** What the six presets are in this theme, for the ink layer, which paints on
   *  a 2d context and cannot read a custom property. */
  let palette = $state.raw<Record<string, string>>({})
  /** Whether the plane has been put in view yet; see `measure`. */
  let placed = false
  /** Where the pointer last was on the plane, so a paste and a new card land
   *  where the reader is looking. */
  let at: Point = { x: 0, y: 0 }
  /** Where the pointer is, for the other devices in the room. The same point as
   *  `at`, said as state, because what the other devices are shown is drawn from it
   *  while `at` is read by a paste rather than followed. Null once it has left. */
  let pointing = $state.raw<Point | null>(null)
  /** Everything but what is picked, faded back. What "narrow to selection" does:
   *  the rest of the plane is still there, it is just not what this is about. */
  let narrowed = $state(false)
  let finding = $state(false)

  const camera = $derived(store.camera)
  /** One screen pixel in plane units. The chrome is sized in these, so it comes
   *  out the same size on screen at every zoom. */
  const unit = $derived(1 / camera.scale)

  /** Where plane 0,0 sits on screen. The plane's transform and the grid's offset
   *  are both this. */
  const originX = $derived(width / 2 - camera.x * camera.scale)
  const originY = $derived(height / 2 - camera.y * camera.scale)
  const stepX = $derived(GRID * camera.scale)

  const gesture = $derived(machine.gesture)
  const drag = $derived(gesture?.kind === 'drag' ? gesture : null)
  const sizing = $derived(gesture?.kind === 'resize' ? gesture : null)
  const inking = $derived(gesture?.kind === 'ink' ? gesture : null)

  /** Everything a snap could line the moving thing up with: what is on the plane
   *  and not going with it. */
  function bystanders(ids: readonly string[]) {
    const moving = new Set(ids)
    return store.canvas.nodes.filter((node) => !moving.has(node.id)).map(boxOf)
  }

  /** How far a drag has really gone, once the grid and the neighbours have had
   *  their say, and the lines that say why. */
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

    const snap = snapResize(now, sizing.handle, bystanders(sizing.ids), GRID / 2)
    return { dx: sizing.dx + snap.dx, dy: sizing.dy + snap.dy, guides: snap.guides }
  })

  /** How far the ink lasso has been dragged, scaled or turned so far. */
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

  /** The plane as it stands with the gesture applied but not committed.
   *
   *  The same pure functions the commit uses, so what is let go of is exactly
   *  what was on screen. Everything the gesture did not touch comes back as the
   *  very same object, so a drag of nine cards among five hundred redraws nine. */
  const shown = $derived.by((): Plane => {
    const base = store.canvas
    if (drag) return movedBy(base, drag.ids, dragSnap.dx, dragSnap.dy)
    if (sizing) return resizedPick(base, sizing.ids, sizing.handle, sizeSnap.dx, sizeSnap.dy)

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

  /** Where the view is, rounded. Numbers rather than a box, so that panning a
   *  few pixels does not count as a change at all; see QUANTUM. */
  const roughX = $derived(Math.round(camera.x / QUANTUM))
  const roughY = $derived(Math.round(camera.y / QUANTUM))
  /** The zoom in quarter octaves, so the set changes on a real change of scale
   *  rather than on every notch of a wheel. */
  const roughZoom = $derived(Math.round(Math.log2(camera.scale) * 4))

  /** The part of the plane worth drawing. */
  const inView = $derived.by(() => {
    const scale = 2 ** (roughZoom / 4)
    const across = width / scale + 2 * SLACK
    const down = height / scale + 2 * SLACK

    return {
      x: roughX * QUANTUM - across / 2,
      y: roughY * QUANTUM - down / 2,
      width: across,
      height: down,
    }
  })

  /** The cards on the page: what is in view, in the order the file holds them,
   *  which is the order they stack in. */
  const cards = $derived(shown.nodes.filter((node) => overlaps(boxOf(node), inView)))

  const picked = $derived(new Set(store.picked))

  /** The box the handles are drawn on: everything picked, together. */
  const box = $derived(pickedBox(shown, store.picked))

  /** Whether what is picked is ink, which is what the turn handle belongs to. */
  const lassoed = $derived(
    store.picked.length > 0 && store.picked.every((id) => shown.ink.some((one) => one.id === id)),
  )

  /** The card the four dots sit on: whatever is under the pointer, and nothing
   *  while a gesture is under way, a card is being written in, or the tool in
   *  hand is not the arrow. */
  const ported = $derived(
    gesture || store.editing !== null || tools.which !== 'select' ? null : machine.hovered,
  )

  const portedBox = $derived(shown.nodes.find((node) => node.id === ported) ?? null)

  /** The connector being drawn from a card's side, as a path. */
  const drawing = $derived.by(() => {
    if (gesture?.kind !== 'connect') return null

    const from = shown.nodes.find((node) => node.id === gesture.id)
    if (!from) return null

    return { from: sidePoint(boxOf(from), gesture.side), to: gesture.to, side: gesture.side }
  })

  const band = $derived(gesture?.kind === 'band' ? rectBetween(gesture.from, gesture.to) : null)
  const lasso = $derived(gesture?.kind === 'lasso' ? gesture.points : null)
  const shaping = $derived(gesture?.kind === 'shape' ? gesture : null)

  /** The stroke under the pen, with whatever the browser guesses is coming next
   *  drawn on the end of it. The guess is drawn and never kept: it is there so
   *  the ink reaches the nib, and it is wrong by the next event. */
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

  const guides = $derived(dragSnap.guides.length ? dragSnap.guides : sizeSnap.guides)

  /** Where in its own tile the grid sits, which is all a repeating pattern needs
   *  to be moved by. Always positive, unlike the remainder operator. */
  function modulo(value: number, by: number): number {
    return by > 0 ? ((value % by) + by) % by : 0
  }

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // Words that changed under the surface: a version restored, a copy a sync
  // brought over, the file undo putting one back. A plane that had nothing on it
  // is framed the moment something arrives that way.
  $effect(() => {
    follows(tab.note.revision)
    if (store.follow() && !store.framed && width && height) store.fit(width, height)
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

  // The theme's own colours, again, whenever the theme changes. The ink layer
  // paints on a 2d context, which has never heard of a custom property.
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

  // This plane is one several devices may be drawing on, so the surface offers
  // itself to the room its file is in and takes it back when the tab goes. The
  // rooms store joins the two whichever of them arrives second.
  $effect(() => {
    rooms.drawing(tab.note.key, store)
    return () => {
      store.part()
      rooms.drawing(tab.note.key, null)
    }
  })

  // Where this hand is and what it is drawing, on its way to the other devices.
  // Read for their own sake: what travels is the pointer and the stroke under it.
  $effect(() => {
    const shared = store.shared
    if (!shared) return

    shared.hand(pointing, live)
  })

  // The pane being worked in takes the keyboard, so Delete and Ctrl+Z reach the
  // plane the way they reach an editor. Never while a card is being written in:
  // the keys are that card's.
  $effect(() => {
    if (focused && store.editing === null && !finding) host?.focus({ preventScroll: true })
  })

  // Zooming has to stop the page doing anything else with the scroll, and a
  // handler that says so cannot be a passive one.
  $effect(() => {
    const element = host
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  function measure(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    width = Math.round(rect.width)
    height = Math.round(rect.height)

    // A canvas opens with everything on it in view, and only then: the view is
    // the reader's from the first frame on, and a window being resized is no
    // reason at all to move the plane out from under them.
    if (placed) return

    placed = true
    store.fit(width, height)
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

  /** What the point is on, in the shape the machine wants it. */
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

  /** A pen sample, in plane units, with everything the digitiser said about it.
   *
   *  A device that reports no pressure says so as exactly one half, which is what
   *  the Pointer Events spec asks for; a stylus reports its own. Tilt comes
   *  through as written and is zero for a finger and a mouse. */
  function sampleOf(event: PointerEvent, began: number): InkPoint {
    const point = planeAt(event)
    return {
      x: point.x,
      y: point.y,
      pressure: event.pressure > 0 ? event.pressure : 0.5,
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      t: Math.max(0, Math.round(event.timeStamp - began)),
    }
  }

  /** When the stroke in hand began, so its samples carry small numbers. */
  let began = 0
  /** The timer a still pointer is running down, and where it went still. */
  let holding = 0
  let held: Point = { x: 0, y: 0 }

  /** How far a pointer may drift and still count as held, in pixels. */
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

  /** Swallows the click that ends the very press that opened the menu.
   *
   *  A finger held down opens the menu while it is still on the glass, and the
   *  click it leaves behind on the way up is what everything else in the app
   *  uses to close a menu. Without this the menu would open and shut in the same
   *  gesture, which reads as nothing happening at all. */
  function swallowTheNextClick() {
    const stop = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    }

    window.addEventListener('click', stop, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 900)
  }

  /** One event through the machine, and its effects carried out.
   *
   *  The plane as it stands is read before the machine moves on, because an
   *  effect that ends a gesture is the gesture's own last word: what is committed
   *  is what was on screen the instant before the pointer came up. */
  function send(input: Input) {
    const preview = shown
    const next = step(machine, input, {
      tool: tools.which,
      picked: store.picked,
      editing: store.editing,
      scale: camera.scale,
      inkBox: box,
      pen: tools.ink,
      eraser: pens.eraser,
      penSeen: hand.penSeen,
      fingerDraws: hand.fingerDraws,
    })

    machine = next.machine
    for (const effect of next.effects) apply(effect, preview)
  }

  function apply(effect: Effect, preview: Plane) {
    switch (effect.do) {
      case 'pick':
        if (effect.ids.length === 1 && effect.ids[0]) store.pick(effect.ids[0], effect.adding)
        else store.pickAll(effect.ids, effect.adding)
        break
      case 'clear':
        store.clearPicked()
        break
      case 'leave':
        if (store.editing !== null) store.editing = null
        break
      case 'edit':
        store.editing = effect.id
        break
      case 'move':
      case 'resize':
        // The preview is the answer: it is what was drawn, snapped and all.
        store.edit(preview)
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
        run.connect(store, effect.from, effect.fromSide, effect.to, effect.toSide)
        break
      case 'shape':
        run.shape(store, effect.tool, effect.from, effect.to, tools.colour)
        tools.done()
        break
      case 'place':
        void place(store, effect.tool, effect.at)
        tools.done()
        break
      case 'stroke':
        run.stroke(store, effect.stroke)
        predicted = []
        break
      case 'rub':
        run.rub(store, effect.ids)
        break
      case 'cut':
        run.cut(store, effect.at, effect.reach)
        break
      case 'catch':
        run.lasso(store, effect.lasso)
        break
      case 'pan':
        store.camera = {
          ...camera,
          x: camera.x - effect.dx / camera.scale,
          y: camera.y - effect.dy / camera.scale,
        }
        break
      case 'zoom':
        store.camera = zoomed(camera, width, height, effect.at.x, effect.at.y, effect.by)
        break
      case 'menu':
        // Only a hold leaves a click behind; the right button does not.
        if (holding) swallowTheNextClick()
        stopHolding()
        showMenu(effect.at)
        break
      case 'assist':
        assistShape()
        break
    }
  }

  /** A stroke held still at the end becomes what it was aiming at: a line, a
   *  ring or a box. The pen is still down, so what changes is the stroke in
   *  hand and nothing on the plane yet. */
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

  function onPointerDown(event: PointerEvent) {
    if (event.button === 2) return

    const point = planeAt(event)
    at = point
    began = event.timeStamp

    const coarse = event.pointerType === 'touch'
    // A pen on this glass is remembered for good: from now on the finger moves
    // the plane about rather than drawing on it. See canvas/hand.svelte.ts.
    if (event.pointerType === 'pen') hand.sawPen()
    host?.setPointerCapture(event.pointerId)

    send({
      kind: 'down',
      id: event.pointerId,
      pointer: event.pointerType === 'pen' ? 'pen' : coarse ? 'touch' : 'mouse',
      at: point,
      screen: screenAt(event),
      button: event.button,
      shift: event.shiftKey,
      adds: event.ctrlKey || event.metaKey,
      // Chromium turns a pen held with its button into the eraser bit, and some
      // devices report the barrel button as the right one instead. Both mean the
      // same thing to a hand, so both mean it here.
      eraser:
        event.pointerType === 'pen' && ((event.buttons & 32) !== 0 || (event.buttons & 2) !== 0),
      sample: sampleOf(event, began),
      hit: hitFor(point, coarse),
    })

    if (coarse) waitForHold(point)
  }

  function onPointerMove(event: PointerEvent) {
    const point = planeAt(event)
    at = point
    if (store.shared) pointing = point
    const coarse = event.pointerType === 'touch'

    // Every sample since the last event, not just the one that was delivered: a
    // fast stroke is drawn through all of them rather than through a fifth of
    // them. Guarded, because the call is only there in a secure context.
    const samples =
      machine.gesture?.kind === 'draw'
        ? (typeof event.getCoalescedEvents === 'function'
            ? event.getCoalescedEvents()
            : [event]
          ).map((one) => sampleOf(one, began))
        : []

    if (machine.gesture?.kind === 'draw') {
      predicted =
        typeof event.getPredictedEvents === 'function'
          ? event.getPredictedEvents().map((one) => sampleOf(one, began))
          : []
    }

    // A pointer that is moving is not a pointer being held. Measured from where
    // it went still rather than from where it last was, which is this point.
    if (holding && Math.hypot(point.x - held.x, point.y - held.y) * camera.scale > A_TWITCH) {
      stopHolding()
    }

    // Asked for only when it is going to be read. Panning a plane of five
    // thousand strokes does not need to know what is under the pointer, and
    // asking sixty times a second is what a plane that big cannot afford.
    const wants = !machine.gesture || machine.gesture.kind === 'erase'

    send({
      kind: 'move',
      id: event.pointerId,
      at: point,
      screen: screenAt(event),
      samples,
      hit: wants ? hitFor(point, coarse) : NOTHING,
    })

    // A pen that has stopped moving is a pen asking for its shape to be tidied.
    if (machine.gesture?.kind === 'draw') waitForHold(point)
  }

  function onPointerUp(event: PointerEvent) {
    stopHolding()
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
    stopHolding()
    predicted = []
    carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
    send({ kind: 'cancel', id: event.pointerId })
  }

  function onWheel(event: WheelEvent) {
    const element = host
    if (!element) return

    event.preventDefault()
    const rect = element.getBoundingClientRect()

    // Ctrl and the wheel is zoom, which is also what a trackpad pinch arrives as.
    // The wheel on its own moves the plane, which is what a wheel does everywhere.
    if (event.ctrlKey || event.metaKey) {
      store.camera = zoomed(
        camera,
        width,
        height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * 0.0035),
      )
      return
    }

    store.camera = {
      ...camera,
      x: camera.x + event.deltaX / camera.scale,
      y: camera.y + event.deltaY / camera.scale,
    }
  }

  /** A double click on the plane makes a card and opens it; on a card it opens
   *  the card, and on a frame or a connector it asks for the words it wears. */
  function onDoubleClick(event: MouseEvent) {
    const point = planeAt(event)
    void run.open(store, hitFor(point, false), point)
  }

  function showMenu(point: Point) {
    const found = hitFor(point, viewport.touch)
    if (found.node && !store.isPicked(found.node)) store.pick(found.node)
    if (found.edge && !store.isPicked(found.edge)) store.pick(found.edge)
    if (found.stroke && !store.isPicked(found.stroke)) store.pick(found.stroke)

    const rect = host?.getBoundingClientRect()
    const screen = {
      clientX: (rect?.left ?? 0) + (point.x - camera.x) * camera.scale + width / 2,
      clientY: (rect?.top ?? 0) + (point.y - camera.y) * camera.scale + height / 2,
    }

    menu.show(
      new MouseEvent('contextmenu', screen),
      canvasMenu(store, point, {
        path: tab.path,
        name: tab.name,
        palette,
        width,
        height,
        narrowed,
        onnarrow: () => {
          narrowed = !narrowed
          if (narrowed) store.frame(width, height)
        },
        onfind: () => (finding = true),
      }),
      { title: t('Canvas'), near: viewport.touch },
    )
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
    showMenu(planeAt(event))
  }

  /** Whether the key was typed into something that takes words. The find bar
   *  and a card's editor are inside the plane, so their keystrokes bubble up to
   *  it, and the plane's own keys are bare letters: without this, typing "green"
   *  into the search would put a group, a rectangle and an ellipse on the
   *  plane. */
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
      // Held rather than pressed: space is a way of holding the plane, not a
      // command, so nothing happens until the pointer moves as well.
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
  }

  /** What is picked, as a canvas of its own, so it pastes into another canvas
   *  here or in Obsidian. */
  function onCopy(event: ClipboardEvent) {
    if (store.editing !== null || !store.picked.length) return

    event.preventDefault()
    event.clipboardData?.setData('text/plain', writeCanvas(subset(store.canvas, store.picked)))
  }

  function onCut(event: ClipboardEvent) {
    if (store.editing !== null || !store.picked.length) return

    onCopy(event)
    run.remove(store)
  }

  /** Cards from another canvas, a picture, an address, or some words: a paste is
   *  read as whichever of the four it turns out to be. */
  function onPaste(event: ClipboardEvent) {
    if (store.editing !== null) return

    const picture = [...(event.clipboardData?.items ?? [])].find((one) =>
      one.type.startsWith('image/'),
    )

    if (picture) {
      const file = picture.getAsFile()
      if (file) {
        event.preventDefault()
        void run.dropImage(store, file, at, tab.path)
        return
      }
    }

    const text = event.clipboardData?.getData('text/plain').trim()
    if (!text) return

    event.preventDefault()
    run.paste(store, readCanvas(text), text, at)
  }

  /** A note or a picture dragged out of the file list, or a file from the
   *  system, becomes a card where it was dropped. */
  function onDrop(event: DragEvent) {
    const point = planeAt(event)
    const paths = draggedPaths(event.dataTransfer)

    if (paths.length) {
      event.preventDefault()
      run.dropPaths(store, paths, point)
      return
    }

    const files = [...(event.dataTransfer?.files ?? [])].filter((one) =>
      one.type.startsWith('image/'),
    )
    if (!files.length) return

    event.preventDefault()
    for (const [index, file] of files.entries()) {
      void run.dropImage(store, file, { x: point.x, y: point.y + index * GRID * 10 }, tab.path)
    }
  }

  /** The dots mean "this colour", and what they colour is whatever the moment is
   *  about: what is picked, or the pen in hand. */
  function onColour(colour: string | null) {
    if (tools.which === 'draw') {
      pens.set({ colour: colour ?? DEFAULT_INK })
      return
    }

    if (store.picked.length) store.edit(coloured(store.canvas, store.picked, colour))
    else tools.colour = colour ?? DEFAULT_INK
  }

  const barColour = $derived.by(() => {
    if (tools.which === 'draw') {
      return pens.current.colour === DEFAULT_INK ? null : pens.current.colour
    }

    const first = store.picked[0]
    if (first) {
      const node = store.canvas.nodes.find((one) => one.id === first)
      return node?.color ?? store.canvas.edges.find((one) => one.id === first)?.color ?? null
    }

    return tools.colour === DEFAULT_INK ? null : tools.colour
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="canvas"
  class:grabbing={gesture?.kind === 'pan' || gesture?.kind === 'pinch'}
  class:spacing={machine.spacing || tools.which === 'hand'}
  class:drawing={tools.which === 'draw' || tools.which === 'erase'}
  class:narrowed
  bind:this={host}
  role="application"
  aria-label={t('Canvas')}
  tabindex="-1"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onpointerleave={() => (pointing = null)}
  ondblclick={onDoubleClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  oncopy={onCopy}
  oncut={onCut}
  onpaste={onPaste}
  oncontextmenu={onContextMenu}
  ondragover={(event) => {
    if (isTreeDrag(event.dataTransfer) || event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
    }
  }}
  ondrop={onDrop}
>
  <!-- The grid, on a layer of its own that is one tile bigger than the view all
       round and moved by a transform. Moving a repeating background by its own
       position repaints the whole view on every frame of a pan; moving a layer
       is composited and costs nothing. -->
  {#if stepX >= DOTS_UNTIL}
    <div
      class="dots"
      style:--dot-step="{stepX}px"
      style:left="{-stepX}px"
      style:top="{-stepX}px"
      style:width="{width + 2 * stepX}px"
      style:height="{height + 2 * stepX}px"
      style:transform="translate({modulo(originX, stepX)}px, {modulo(originY, stepX)}px)"
    ></div>
  {/if}

  <div class="plane" style:transform="translate({originX}px, {originY}px) scale({camera.scale})">
    <CanvasEdges
      edges={shown.edges}
      nodes={shown.nodes}
      picked={store.picked}
      provisional={drawing}
    />

    {#each cards as node (node.id)}
      <CanvasNode
        {node}
        canvasPath={tab.path}
        root={workspace.activeSpace?.root ?? null}
        picked={picked.has(node.id)}
        dimmed={narrowed && !picked.has(node.id)}
        editing={store.editing === node.id}
        offset={STILL}
        ontext={(text: string) => store.edit(withText(store.canvas, node.id, text))}
        onleave={() => (store.editing = null)}
        onfollow={(jump: NoteJump) => void workspace.followLink(jump)}
      />
    {/each}

    <!-- The four dots a connector is drawn from, on whichever card the pointer is
         over. Sized in plane units so they are the same size on screen at any
         zoom. -->
    {#if portedBox}
      {#each SIDES as side (side)}
        {@const point = sidePoint(boxOf(portedBox), side)}
        <div
          class="port"
          style:left="{point.x}px"
          style:top="{point.y}px"
          style:width="{PORT * unit}px"
          style:height="{PORT * unit}px"
        ></div>
      {/each}
    {/if}

    <!-- What is picked, and the handles that resize it. -->
    {#if box}
      <div
        class="frame"
        style:left="{box.x}px"
        style:top="{box.y}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        style:border-width="{unit}px"
      ></div>

      {#each HANDLES as handle (handle.id)}
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

    {#if shaping}
      {@const preview = rectBetween(shaping.from, shaping.to)}
      <div
        class="band shaping"
        class:round={shaping.tool === 'ellipse'}
        style:left="{preview.x}px"
        style:top="{preview.y}px"
        style:width="{preview.width}px"
        style:height="{preview.height}px"
      ></div>
    {/if}

    <!-- The lines that say what a drag lined itself up with. -->
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

    <!-- The other hands on the plane, over everything on it. Inside the plane, so
         a pointer somebody else is moving stays where they are pointing. -->
    <CanvasHands hands={store.hands} {unit} {palette} />
  </div>

  <CanvasInk ink={shown.ink} {live} {camera} {width} {height} {picked} {palette} />

  <!-- Two bars, because a thumb and a mouse are not the same hand. A pointer gets
       the compact row of glyphs; a finger gets the pen bar, whose pens are drawn
       as pens and whose settings open where it stands. -->
  {#if viewport.touch}
    <CanvasPens
      oncolour={onColour}
      colour={barColour}
      colouring={store.picked.length > 0}
      canundo={store.canUndo}
      canredo={store.canRedo}
      onundo={() => store.undo()}
      onredo={() => store.redo()}
      onerase={() => run.eraseAll(store)}
    />
  {:else}
    <CanvasBar
      oncolour={onColour}
      onsize={(size: number) => pens.set({ size })}
      colour={barColour}
      size={pens.current.size}
      colouring={store.picked.length > 0}
    />
  {/if}

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
    overflow: hidden;
    background: var(--bg);
    outline: none;
    /* The plane is the thing being touched, so a drag on it must not start a
       text selection or the browser's own panning. */
    touch-action: none;
    user-select: none;
    cursor: default;
  }

  /* The grid, drawn on the view rather than on the plane: a repeating background
     costs one paint however far the plane reaches, and this layer is moved by a
     transform rather than by its own background position, so panning it is a
     composite and never a repaint. */
  .dots {
    position: absolute;
    pointer-events: none;
    background-image: radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px);
    background-size: var(--dot-step) var(--dot-step);
    will-change: transform;
  }

  .canvas.spacing {
    cursor: grab;
  }

  .canvas.grabbing {
    cursor: grabbing;
  }

  .canvas.drawing {
    cursor: crosshair;
  }

  /* No size of its own: everything in it is absolute at its own plane
     coordinates, and this one transform is how the whole plane moves. */
  .plane {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  /* Centred on the point they mark, so the arithmetic above is about a point
     rather than about a corner. */
  .port,
  .handle,
  .turn {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
    z-index: 5;
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

  .handle {
    border-radius: 2px;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  /* The ring that turns what is picked, above it and clear of every corner. */
  .turn {
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  /* The outline round everything picked. Drawn even for one card, so a
     selection of one and a selection of nine read as the same thing. */
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    border-radius: 3px;
    pointer-events: none;
    z-index: 5;
  }

  .band {
    position: absolute;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    pointer-events: none;
    z-index: 5;
  }

  .band.shaping {
    background: none;
    border-style: dashed;
  }

  .band.shaping.round {
    border-radius: 50%;
  }

  /* The line that says what a drag lined itself up with: the accent, and only
     while the pointer is down. */
  .guide {
    position: absolute;
    background: var(--accent);
    opacity: 0.7;
    pointer-events: none;
    z-index: 5;
  }

  .lasso {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 5;
  }

  .lasso path {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }
</style>
