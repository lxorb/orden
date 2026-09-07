<script lang="ts">
  /** A canvas: an endless plane with cards on it, in a tab like a note.
   *
   *  One transform for the whole plane. The cards are ordinary elements at the
   *  coordinates the file gives them, the connectors are one SVG layer beside
   *  them, and panning and zooming move the plane rather than anything in it - so
   *  a pan is a composited transform with no layout to redo, whether there are
   *  five cards or five hundred. Cards far off screen are left out of the page
   *  altogether; the connectors stay, because a path costs nothing to keep and a
   *  line that vanished with its card would flicker.
   *
   *  A gesture is one edit. Dragging nine cards across the plane carries them by a
   *  transform while the pointer is down and writes the file once when it comes
   *  up, so it is one undo step and one save rather than ninety.
   *
   *  Keys. Undo, redo and select all are read off the shortcut registry, so a
   *  reader who rebound them has their own keys here too. Delete, Escape, Ctrl+0
   *  and Ctrl+D are read straight: they mean something only while a plane is the
   *  surface in front, so they are not app-wide bindings to go looking for in a
   *  list. Copy and paste are the browser's own events, which is where they
   *  belong. */

  import { untrack } from 'svelte'
  import type { NoteJump } from '@nib/editor'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasEdges from './CanvasEdges.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import { graphPoint, zoomed } from './camera'
  import {
    type CanvasNode as Card,
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    freshId,
    type NodeKind,
    readCanvas,
    type Side,
    writeCanvas,
  } from './canvas/format'
  import {
    connected,
    copied,
    coloured,
    movedBy,
    pasted,
    placedAt,
    removed,
    resizedNode,
    subset,
    withGroup,
    withLabel,
    withNode,
    withText,
  } from './canvas/edits'
  import {
    bounds,
    boxOf,
    caught,
    edgePath,
    facingSide,
    GRID,
    HANDLES,
    type HandleId,
    nodeAt,
    overlaps,
    type Point,
    rectBetween,
    sidePoint,
    snapped,
  } from './canvas/geometry'
  import { CanvasStore } from './canvas/store.svelte'
  import { dragged as draggedPaths, isTreeDrag } from './drag-paths'
  import { key, t } from './i18n.svelte'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { prompt } from './prompt.svelte'
  import { insideSpace, relativeTo } from './space-paths'
  import { shortcuts } from './shortcuts.svelte'
  import { openExternal } from './tauri'
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

  /** How far a pointer may travel and still count as a click, in pixels. */
  const A_CLICK = 3

  /** How big the chrome is on screen, in pixels, whatever the zoom. */
  const HANDLE = 9
  const PORT = 8

  /** Below this the dots are closer together than they are wide, and the grid
   *  stops being a grid and becomes a wash. */
  const DOTS_UNTIL = 7

  /** A card that is not being dragged, so the each block below hands over the
   *  same object every frame rather than a fresh zero. */
  const STILL: Point = { x: 0, y: 0 }

  const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  /** Space held, which turns a drag anywhere into a pan. */
  let spacing = $state(false)
  /** Where the pointer last was on the plane, so a paste and a new card land
   *  where the reader is looking. */
  let at: Point = { x: 0, y: 0 }

  type Gesture =
    | { kind: 'pan'; screen: Point }
    | { kind: 'drag'; ids: string[]; screen: Point; dx: number; dy: number }
    | { kind: 'resize'; id: string; handle: HandleId; screen: Point; dx: number; dy: number }
    | { kind: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
    | { kind: 'connect'; id: string; side: Side; to: Point }

  let gesture = $state<Gesture | null>(null)
  /** The card the pointer is over, which is what wears the four dots an edge is
   *  drawn from. */
  let hovered = $state<string | null>(null)

  const camera = $derived(store.camera)
  /** One screen pixel in plane units. The chrome is sized in these, so it comes
   *  out the same size on screen at every zoom. */
  const unit = $derived(1 / camera.scale)

  /** Where plane 0,0 sits on screen. The plane's transform and the grid's offset
   *  are both this. */
  const originX = $derived(width / 2 - camera.x * camera.scale)
  const originY = $derived(height / 2 - camera.y * camera.scale)
  const step = $derived(GRID * camera.scale)

  const drag = $derived(gesture?.kind === 'drag' ? gesture : null)
  /** How far the cards being dragged have gone, on the grid. */
  const carried = $derived(drag ? { x: snapped(drag.dx), y: snapped(drag.dy) } : STILL)
  const moving = $derived(drag ? new Set(drag.ids) : null)

  /** Every card by id, where it is now: the file's position, plus whatever a drag
   *  has carried. Depends on the cards and on the drag and not on the camera, so a
   *  pan rebuilds nothing. What the connectors, the handles and the dots are drawn
   *  from. */
  const boxes = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole whenever the cards or the drag change
    const map = new Map<string, Card>()

    for (const node of store.canvas.nodes) {
      map.set(
        node.id,
        moving?.has(node.id) ? { ...node, x: node.x + carried.x, y: node.y + carried.y } : node,
      )
    }

    return map
  })

  /** The part of the plane worth drawing. */
  const inView = $derived({
    x: camera.x - width / 2 / camera.scale - SLACK,
    y: camera.y - height / 2 / camera.scale - SLACK,
    width: width / camera.scale + 2 * SLACK,
    height: height / camera.scale + 2 * SLACK,
  })

  /** The cards on the page: what is in view, in the order the file holds them,
   *  which is the order they stack in. */
  const shown = $derived(
    store.canvas.nodes.filter((node) => overlaps(boxOf(boxes.get(node.id) ?? node), inView)),
  )

  /** The one card that is picked, when exactly one is: what wears the handles.
   *  Several picked share an outline and no handles, since resizing nine cards at
   *  once is not a gesture anybody makes. */
  const only = $derived(
    store.picked.length === 1 ? (boxes.get(store.picked[0] ?? '') ?? null) : null,
  )

  /** The card the four dots sit on: whatever is under the pointer, and nothing
   *  while a gesture is under way or a card is being written in. */
  const ported = $derived(
    gesture || store.editing !== null ? null : (boxes.get(hovered ?? '') ?? null),
  )

  /** The connector being drawn from a card's side, as a path. */
  const drawing = $derived.by(() => {
    if (gesture?.kind !== 'connect') return null

    const from = boxes.get(gesture.id)
    if (!from) return null

    const box = boxOf(from)
    const to = gesture.to

    return edgePath({
      from: sidePoint(box, gesture.side),
      to,
      fromSide: gesture.side,
      toSide: facingSide({ ...to, width: 0, height: 0 }, box),
    })
  })

  const band = $derived(gesture?.kind === 'band' ? rectBetween(gesture.from, gesture.to) : null)

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // Words that changed under the surface: a version restored, a copy a sync
  // brought over, the file undo putting one back.
  $effect(() => {
    follows(tab.note.revision)
    store.follow()
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => measure(element))
    watcher.observe(element)
    measure(element)

    return () => watcher.disconnect()
  })

  // The pane being worked in takes the keyboard, so Delete and Ctrl+Z reach the
  // plane the way they reach an editor. Never while a card is being written in:
  // the keys are that card's.
  $effect(() => {
    if (focused && store.editing === null) host?.focus({ preventScroll: true })
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
    const box = element.getBoundingClientRect()
    if (!box.width || !box.height) return

    width = Math.round(box.width)
    height = Math.round(box.height)
    // A canvas opens with everything on it in view. Once only: where the reader
    // panned to is theirs from then on.
    if (!store.framed) store.fit(width, height)
  }

  function planeAt(event: { clientX: number; clientY: number }): Point {
    const element = host
    if (!element) return { x: 0, y: 0 }

    const box = element.getBoundingClientRect()
    return graphPoint(camera, width, height, event.clientX - box.left, event.clientY - box.top)
  }

  function onWheel(event: WheelEvent) {
    const element = host
    if (!element) return

    event.preventDefault()
    const box = element.getBoundingClientRect()

    // Ctrl and the wheel is zoom, which is also what a trackpad pinch arrives as.
    // The wheel on its own moves the plane, which is what a wheel does everywhere.
    if (event.ctrlKey || event.metaKey) {
      store.camera = zoomed(
        camera,
        width,
        height,
        event.clientX - box.left,
        event.clientY - box.top,
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

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return

    const point = planeAt(event)
    at = point

    // Space, or the middle button, pans from anywhere: a hand that has learned
    // either uses it over a card as readily as over the plane.
    if (spacing || event.button === 1) {
      hold(event, { kind: 'pan', screen: { x: event.clientX, y: event.clientY } })
      return
    }

    const element = event.target instanceof Element ? event.target : null
    const handle = element?.closest('[data-handle]')
    const port = element?.closest('[data-side]')
    const edge = element?.closest('[data-edge]')

    if (handle instanceof HTMLElement && only) {
      const which = handle.dataset.handle
      const found = HANDLES.find((one) => one.id === which)
      if (found) {
        hold(event, {
          kind: 'resize',
          id: only.id,
          handle: found.id,
          screen: { x: event.clientX, y: event.clientY },
          dx: 0,
          dy: 0,
        })
      }
      return
    }

    if (port instanceof HTMLElement && ported) {
      const side = SIDES.find((one) => one === port.dataset.side)
      if (side) hold(event, { kind: 'connect', id: ported.id, side, to: point })
      return
    }

    if (edge instanceof SVGElement) {
      const id = edge.dataset.edge
      if (id) store.pick(id, adds(event))
      leaveEditing()
      return
    }

    const node = nodeAt(store.canvas.nodes, point)

    // A card being written in keeps the pointer: it is a text field, and a drag
    // in one selects words.
    if (store.editing !== null && node?.id === store.editing) return

    if (!node) {
      leaveEditing()
      // Dragging the plane moves the plane, which is what the brief and every
      // hand expect. A rubber band is the same drag with Shift or Ctrl held, and
      // Ctrl means what it means for a click: add rather than replace.
      if (event.shiftKey || adds(event)) {
        if (!adds(event)) store.clearPicked()
        hold(event, {
          kind: 'band',
          from: point,
          to: point,
          was: adds(event) ? [...store.picked] : [],
          adding: adds(event),
        })
      } else {
        store.clearPicked()
        hold(event, { kind: 'pan', screen: { x: event.clientX, y: event.clientY } })
      }
      return
    }

    leaveEditing()
    if (adds(event) || !store.isPicked(node.id)) store.pick(node.id, adds(event))
    if (!store.picked.length) return

    hold(event, {
      kind: 'drag',
      ids: [...store.picked],
      screen: { x: event.clientX, y: event.clientY },
      dx: 0,
      dy: 0,
    })
  }

  /** Whether the keys held mean "as well as", which is Ctrl on Windows and Linux
   *  and Cmd on a Mac: added to what is picked, and on its own the key that a
   *  handful of the plane's own gestures hang off. */
  function adds(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
    return event.ctrlKey || event.metaKey
  }

  function hold(event: PointerEvent, one: Gesture) {
    host?.setPointerCapture(event.pointerId)
    gesture = one
  }

  function onPointerMove(event: PointerEvent) {
    at = planeAt(event)

    const one = gesture
    if (!one) {
      const id = nodeAt(store.canvas.nodes, at)?.id ?? null
      if (id !== hovered) hovered = id
      return
    }

    switch (one.kind) {
      case 'pan': {
        const scale = camera.scale
        store.camera = {
          x: camera.x - (event.clientX - one.screen.x) / scale,
          y: camera.y - (event.clientY - one.screen.y) / scale,
          scale,
        }
        gesture = { ...one, screen: { x: event.clientX, y: event.clientY } }
        break
      }
      case 'drag':
      case 'resize':
        gesture = {
          ...one,
          dx: (event.clientX - one.screen.x) / camera.scale,
          dy: (event.clientY - one.screen.y) / camera.scale,
        }
        break
      case 'band': {
        gesture = { ...one, to: at }
        const inside = caught(store.canvas.nodes, rectBetween(one.from, at))
        store.pickAll([...one.was, ...inside])
        break
      }
      case 'connect':
        gesture = { ...one, to: at }
        break
    }
  }

  function onPointerUp(event: PointerEvent) {
    const one = gesture
    gesture = null
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
    if (!one) return

    switch (one.kind) {
      case 'drag':
        // A drag that was really a click has nothing to record.
        if (Math.hypot(one.dx, one.dy) * camera.scale > A_CLICK) {
          store.edit(movedBy(store.canvas, one.ids, one.dx, one.dy))
        }
        break
      case 'resize':
        store.edit(resizedNode(store.canvas, one.id, one.handle, one.dx, one.dy))
        break
      case 'connect': {
        const target = nodeAt(store.canvas.nodes, one.to)
        const from = boxes.get(one.id)
        if (!target || !from || target.id === one.id) break

        store.edit(
          connected(
            store.canvas,
            one.id,
            one.side,
            target.id,
            facingSide(boxOf(target), boxOf(from)),
          ),
        )
        break
      }
      case 'pan':
      case 'band':
        break
    }
  }

  /** A double click on the plane makes a card and opens it; on a card it opens
   *  the card, and on a frame or a connector it asks for the words it wears. */
  function onDoubleClick(event: MouseEvent) {
    const point = planeAt(event)
    const element = event.target instanceof Element ? event.target : null
    const edge = element?.closest('[data-edge]')

    if (edge instanceof SVGElement && edge.dataset.edge) {
      void askForLabel(edge.dataset.edge)
      return
    }

    const node = nodeAt(store.canvas.nodes, point)
    if (!node) {
      addNode('text', point)
      return
    }

    switch (node.type) {
      case 'text':
        store.editing = node.id
        break
      case 'group':
        void askForLabel(node.id)
        break
      case 'link':
        void openExternal(node.url)
        break
      case 'file':
        void openFile(node.file)
        break
    }
  }

  async function openFile(file: string) {
    const root = workspace.activeSpace?.root
    if (root) await workspace.openEntry(insideSpace(root, file))
  }

  async function askForLabel(id: string) {
    const answer = await prompt.ask({
      title: t('Name this'),
      value: labelOf(id),
      confirmLabel: key('Save'),
    })

    if (answer !== null) store.edit(withLabel(store.canvas, id, answer))
  }

  function labelOf(id: string): string {
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (node?.type === 'group') return node.label ?? ''

    return store.canvas.edges.find((one) => one.id === id)?.label ?? ''
  }

  function leaveEditing() {
    if (store.editing !== null) store.editing = null
  }

  function addNode(kind: NodeKind, point: Point = at) {
    switch (kind) {
      case 'file':
        void askForFile(point)
        return
      case 'link':
        void askForUrl(point)
        return
      case 'group': {
        // Room enough to put a handful of cards in, which is what a frame is for.
        const box = placedAt(point, GRID * 20, GRID * 12)
        const id = freshId()
        store.edit(withGroup(store.canvas, { ...box, id, type: 'group' }))
        store.pick(id)
        return
      }
      case 'text': {
        const box = placedAt(point, DEFAULT_WIDTH, DEFAULT_HEIGHT)
        const id = freshId()
        store.edit(withNode(store.canvas, { ...box, id, type: 'text', text: '' }))
        store.pick(id)
        // A card made by hand is a card somebody is about to write in.
        store.editing = id
      }
    }
  }

  async function askForFile(point: Point) {
    const root = workspace.activeSpace?.root
    if (!root) return

    const chosen = await prompt.find({
      title: t('Which note'),
      placeholder: t('Search'),
      options: workspace.files.map((one) => {
        const relative = relativeTo(root, one.path)
        return { id: relative, label: relative }
      }),
    })

    if (chosen) putFile(chosen, point)
  }

  function putFile(file: string, point: Point) {
    const box = placedAt(point, DEFAULT_WIDTH, GRID * 9)
    const id = freshId()
    store.edit(withNode(store.canvas, { ...box, id, type: 'file', file }))
    store.pick(id)
  }

  async function askForUrl(point: Point) {
    const url = await prompt.ask({
      title: t('Which address'),
      placeholder: t('Address'),
      confirmLabel: key('Add'),
    })

    if (url) putLink(url, point)
  }

  function putLink(url: string, point: Point) {
    const box = placedAt(point, DEFAULT_WIDTH, GRID * 4)
    const id = freshId()
    store.edit(withNode(store.canvas, { ...box, id, type: 'link', url }))
    store.pick(id)
  }

  function putText(text: string, point: Point) {
    const box = placedAt(point, DEFAULT_WIDTH, DEFAULT_HEIGHT)
    const id = freshId()
    store.edit(withNode(store.canvas, { ...box, id, type: 'text', text }))
    store.pick(id)
  }

  function deletePicked() {
    if (!store.picked.length) return

    store.edit(removed(store.canvas, store.picked))
    store.clearPicked()
  }

  function duplicate() {
    if (!store.picked.length) return

    const made = copied(store.canvas, store.picked)
    store.edit(made.canvas)
    store.pickAll(made.ids)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === ' ' && store.editing === null) {
      // Held rather than pressed: space is a way of holding the plane, not a
      // command, so nothing happens until the pointer moves as well.
      event.preventDefault()
      spacing = true
      return
    }

    if (event.key === 'Escape') {
      if (store.editing !== null) leaveEditing()
      else store.clearPicked()
      return
    }

    if (store.editing !== null) return

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!store.picked.length) return

      event.preventDefault()
      deletePicked()
      return
    }

    // Its own key rather than the app's Actual size, which is about how big the
    // text is: on a plane, zoom is only how much of it is in view, and Ctrl+0 is
    // what puts all of it there.
    if (event.key === '0' && adds(event)) {
      event.preventDefault()
      store.fit(width, height)
      return
    }

    if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      duplicate()
      return
    }

    if (shortcuts.pressed('edit.select-all', event)) {
      event.preventDefault()
      store.pickAll(store.canvas.nodes.map((node) => node.id))
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
    if (event.key === ' ') spacing = false
  }

  /** What is picked, as a canvas of its own, so it pastes into another canvas
   *  here or in Obsidian. */
  function onCopy(event: ClipboardEvent) {
    if (store.editing !== null || !store.picked.length) return

    event.preventDefault()
    event.clipboardData?.setData('text/plain', writeCanvas(subset(store.canvas, store.picked)))
  }

  /** Cards from another canvas, an address, or some words: a paste is read as
   *  whichever of the three it turns out to be. */
  function onPaste(event: ClipboardEvent) {
    if (store.editing !== null) return

    const text = event.clipboardData?.getData('text/plain').trim()
    if (!text) return

    event.preventDefault()
    const held = readCanvas(text)

    if (held.nodes.length) {
      // Centred on the pointer, so a paste lands where the reader is looking
      // rather than where the cards happened to be in the canvas they came from.
      const box = bounds(held.nodes)
      const dx = box ? snapped(at.x - box.x - box.width / 2) : 0
      const dy = box ? snapped(at.y - box.y - box.height / 2) : 0
      const made = pasted(store.canvas, held, dx, dy)

      store.edit(made.canvas)
      store.pickAll(made.ids)
      return
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) putLink(text, at)
    else putText(text, at)
  }

  /** A note or a picture dragged out of the file list becomes a card where it was
   *  dropped. Several of them go one under the other, which is where a hand
   *  dropping a folder's worth would put them anyway. */
  function onDrop(event: DragEvent) {
    const root = workspace.activeSpace?.root
    const paths = draggedPaths(event.dataTransfer)
    if (!root || !paths.length) return

    event.preventDefault()
    const point = planeAt(event)

    for (const [index, path] of paths.entries()) {
      putFile(relativeTo(root, path), { x: point.x, y: point.y + index * GRID * 10 })
    }
  }

  function onContextMenu(event: MouseEvent) {
    const point = planeAt(event)
    const node = nodeAt(store.canvas.nodes, point)
    if (node && !store.isPicked(node.id)) store.pick(node.id)

    menu.show(event, planeMenu(point), { title: t('Canvas') })
  }

  function planeMenu(point: Point): MenuEntry[] {
    const picked = store.picked.length > 0

    return [
      { label: t('Card'), run: () => addNode('text', point) },
      { label: t('Note or picture'), run: () => addNode('file', point) },
      { label: t('Link'), run: () => addNode('link', point) },
      { label: t('Group'), run: () => addNode('group', point) },
      DIVIDER,
      { label: t('Duplicate'), disabled: !picked, run: duplicate },
      { label: t('Delete'), danger: true, disabled: !picked, run: deletePicked },
      DIVIDER,
      { label: t('Fit the canvas'), run: () => store.fit(width, height) },
    ]
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="canvas"
  class:grabbing={gesture?.kind === 'pan'}
  class:spacing
  class:dots={step >= DOTS_UNTIL}
  bind:this={host}
  role="application"
  aria-label={t('Canvas')}
  tabindex="-1"
  style:--dot-step="{step}px"
  style:--dot-x="{originX}px"
  style:--dot-y="{originY}px"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={() => (hovered = null)}
  ondblclick={onDoubleClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  oncopy={onCopy}
  onpaste={onPaste}
  oncontextmenu={onContextMenu}
  ondragover={(event) => {
    if (isTreeDrag(event.dataTransfer)) event.preventDefault()
  }}
  ondrop={onDrop}
>
  <div class="plane" style:transform="translate({originX}px, {originY}px) scale({camera.scale})">
    <CanvasEdges edges={store.canvas.edges} {boxes} picked={store.picked} provisional={drawing} />

    {#each shown as node (node.id)}
      <CanvasNode
        {node}
        canvasPath={tab.path}
        root={workspace.activeSpace?.root ?? null}
        picked={store.isPicked(node.id)}
        editing={store.editing === node.id}
        offset={moving?.has(node.id) ? carried : STILL}
        ontext={(text: string) => store.edit(withText(store.canvas, node.id, text))}
        onleave={leaveEditing}
        onfollow={(jump: NoteJump) => void workspace.followLink(jump)}
      />
    {/each}

    <!-- The four dots a connector is drawn from, on whichever card the pointer is
         over. Sized in plane units so they are the same size on screen at any
         zoom. -->
    {#if ported}
      {#each SIDES as side (side)}
        {@const point = sidePoint(boxOf(ported), side)}
        <div
          class="port"
          data-side={side}
          style:left="{point.x}px"
          style:top="{point.y}px"
          style:width="{PORT * unit}px"
          style:height="{PORT * unit}px"
        ></div>
      {/each}
    {/if}

    <!-- The eight handles of the one card that is picked. -->
    {#if only}
      {#each HANDLES as handle (handle.id)}
        <div
          class="handle"
          data-handle={handle.id}
          style:left="{only.x + ((handle.x + 1) / 2) * only.width}px"
          style:top="{only.y + ((handle.y + 1) / 2) * only.height}px"
          style:width="{HANDLE * unit}px"
          style:height="{HANDLE * unit}px"
        ></div>
      {/each}
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
  </div>

  <CanvasBar
    onadd={(kind: NodeKind) => addNode(kind)}
    oncolour={(colour: string | null) => store.edit(coloured(store.canvas, store.picked, colour))}
    colouring={store.picked.length > 0}
  />
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
     costs one paint however far the plane reaches. */
  .canvas.dots {
    background-image: radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px);
    background-size: var(--dot-step) var(--dot-step);
    background-position: var(--dot-x) var(--dot-y);
  }

  .canvas.spacing {
    cursor: grab;
  }

  .canvas.grabbing {
    cursor: grabbing;
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
  .handle {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
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

  .band {
    position: absolute;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    pointer-events: none;
  }
</style>
