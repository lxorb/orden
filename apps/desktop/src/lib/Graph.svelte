<script lang="ts">
  /** A graph of notes on a canvas: the same surface for the whole space and for
   *  one note's neighbourhood, since the only difference between them is which
   *  graph they are handed.
   *
   *  Everything that moves is driven from one frame loop rather than from the
   *  reactive graph: the arrangement settles over about half a second, and after
   *  that a frame is asked for only when something happens - a pointer moving, a
   *  scroll, a theme changing. A graph nobody is touching costs nothing. */

  import { onDestroy } from 'svelte'
  import type { NoteGraph } from './graph'
  import { Layout } from './graph-layout'
  import { type Camera, framing, graphPoint, nodeAt, zoomed } from './camera'
  import { type GraphColours, paint, radiusOf } from './graph-paint'
  import { t } from './i18n.svelte'
  import { stillness } from './motion'
  import { theme } from './theme.svelte'

  const {
    graph,
    current = null,
    onopen,
    onescape,
  }: {
    graph: NoteGraph
    /** The id of the note being read, so it can be marked. */
    current?: string | null
    /** A node was clicked: opened as a preview, or kept on a double click, the
     *  way a row in the file list opens. */
    onopen?: ((path: string, keep: boolean) => void) | undefined
    onescape?: (() => void) | undefined
  } = $props()

  /** How long a frame may spend settling the arrangement, in milliseconds. A
   *  count of ticks would be wrong on one machine or the other: a tick over ten
   *  notes is nothing and a tick over two thousand is a millisecond or two. So
   *  the frame takes as many as fit and no more, which keeps a small graph
   *  settled by the second frame and a large one at sixty frames a second while
   *  it finds its shape. Six leaves the rest of the frame for the drawing. */
  const A_FRAME = 6

  /** How far a pointer may travel and still count as a click rather than a
   *  drag. */
  const A_CLICK = 3

  /** Room left around the graph when it is framed. */
  const PADDING = 24

  let host = $state<HTMLElement>()
  let canvas = $state<HTMLCanvasElement>()

  let layout: Layout | null = null
  let radii = new Float64Array(0)
  let lit = new Uint8Array(0)
  let camera: Camera = { x: 0, y: 0, scale: 1 }
  let colours: GraphColours | null = null
  let width = 0
  let height = 0
  let hovered = -1

  let frame = 0
  /** Whether the reader has moved the view themselves. Until they have, the view
   *  keeps the whole graph framed as it settles, so the picture arrives already
   *  in view rather than needing to be found. The moment it is panned, zoomed or
   *  a note is dragged, the view is theirs and nothing moves it again. */
  let touched = false
  /** Whether a drag is moving the view. State, because the cursor says so. */
  let panning = $state(false)
  let holding = -1
  /** The note the last click opened. A second click keeps it, the way a second
   *  click on a row in the file list does - and it has to be remembered rather
   *  than looked up again, because the first click has already opened a note and
   *  the picture may be a different one by the time the second arrives. */
  let clicked: string | null = null
  let lastX = 0
  let lastY = 0
  let travelled = 0

  /** The shape of the graph, as one string. The panel is handed a fresh graph
   *  object whenever anything in the space is saved, and laying the arrangement
   *  out again then would make the picture jump every time the typing pauses.
   *  This is what says whether it is really another graph.
   *
   *  Newline-separated, since that is the one character a note's path cannot
   *  hold, so two different sets of notes cannot read as the same graph. */
  const shape = $derived(
    [
      graph.nodes.map((node) => node.id).join('\n'),
      graph.edges.map((edge) => `${edge.a},${edge.b}`).join(' '),
    ].join('\n'),
  )

  const currentAt = $derived(
    current === null ? -1 : graph.nodes.findIndex((node) => node.id === current),
  )

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // A different graph is a different arrangement, framed afresh. The same graph
  // handed over again is not, so the view stays where the reader left it.
  $effect(() => {
    follows(shape)
    rebuild()
  })

  // The note being read, and the theme, change what is drawn but not where
  // anything is.
  $effect(() => {
    follows(currentAt)
    follows(theme.current)
    follows(theme.accent)
    colours = null
    schedule()
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => resize())
    watcher.observe(element)
    resize()

    return () => watcher.disconnect()
  })

  // Zooming has to stop the page from doing anything else with the scroll, and a
  // handler that says so cannot be a passive one.
  $effect(() => {
    const element = canvas
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  function rebuild() {
    layout = new Layout(graph)
    radii = new Float64Array(graph.nodes.map((node) => radiusOf(node.degree)))
    lit = new Uint8Array(graph.nodes.length)
    hovered = -1

    // A reader who has asked for less movement gets the arrangement it arrives
    // at, without watching it get there.
    if (stillness()) layout.settle()

    touched = false
    frameGraph()
    schedule()
  }

  /** Puts the whole graph in view. */
  function frameGraph() {
    if (!layout) return
    camera = framing(layout.x, layout.y, graph.nodes.length, width, height, PADDING)
  }

  function resize() {
    const element = host
    const surface = canvas
    if (!element || !surface) return

    const box = element.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const next = { width: Math.round(box.width), height: Math.round(box.height) }
    if (!next.width || !next.height) return

    width = next.width
    height = next.height
    surface.width = Math.round(width * ratio)
    surface.height = Math.round(height * ratio)

    // Setting the size clears the canvas and its transform, so the scale that
    // makes one unit a css pixel goes on again here.
    surface.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)

    if (!touched) frameGraph()
    schedule()
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(run)
  }

  function run() {
    frame = 0
    const arrangement = layout
    if (!arrangement) return

    // As many ticks as the frame has room for. Another frame is asked for only
    // while there is still settling to do, so an arrangement that has arrived
    // costs one draw and nothing after it.
    const until = performance.now() + A_FRAME
    while (!arrangement.settled && performance.now() < until) arrangement.tick()
    if (!arrangement.settled) schedule()

    // The arrangement spreads out as it settles, so the view follows it until it
    // has arrived - or until the reader takes the view over.
    if (!touched) frameGraph()
    draw()
  }

  /** The colours the graph is drawn in, read from the stylesheet so a theme
   *  change is all it takes. Read once and again whenever the theme moves. */
  function palette(element: HTMLElement): GraphColours {
    const style = getComputedStyle(element)
    const token = (name: string) => style.getPropertyValue(name).trim()

    return {
      edge: token('--line-strong'),
      litEdge: token('--accent'),
      node: token('--muted'),
      hollow: token('--muted'),
      current: token('--accent'),
      label: token('--muted-strong'),
      font: token('--font-ui') || 'sans-serif',
    }
  }

  function draw() {
    const surface = canvas
    const element = host
    if (!surface || !element || !layout) return

    const context = surface.getContext('2d')
    if (!context) return

    colours ??= palette(element)
    context.clearRect(0, 0, width, height)

    paint(context, {
      graph,
      x: layout.x,
      y: layout.y,
      radii,
      camera,
      width,
      height,
      colours,
      current: currentAt,
      hovered,
      lit,
    })
  }

  /** Which nodes belong to what is being pointed at: the node itself, and
   *  everything one link from it. Everything else is drawn faint. */
  function relight(node: number) {
    lit.fill(0)
    if (node < 0) return

    lit[node] = 2
    for (const edge of graph.edges) {
      if (edge.a === node) lit[edge.b] ||= 1
      else if (edge.b === node) lit[edge.a] ||= 1
    }
  }

  function at(event: PointerEvent | MouseEvent): number {
    const surface = canvas
    if (!surface || !layout) return -1

    const box = surface.getBoundingClientRect()
    return nodeAt(
      layout.x,
      layout.y,
      radii,
      camera,
      width,
      height,
      event.clientX - box.left,
      event.clientY - box.top,
    )
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return

    canvas?.setPointerCapture(event.pointerId)
    lastX = event.clientX
    lastY = event.clientY
    travelled = 0

    const node = at(event)
    if (node >= 0) holding = node
    else panning = true
  }

  function onPointerMove(event: PointerEvent) {
    const surface = canvas
    if (!surface) return

    if (holding >= 0 && layout) {
      travelled += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY

      // Only once it is a drag rather than a click, so a click does not nudge
      // the node it lands on.
      if (travelled > A_CLICK) {
        touched = true
        const box = surface.getBoundingClientRect()
        const point = graphPoint(
          camera,
          width,
          height,
          event.clientX - box.left,
          event.clientY - box.top,
        )
        layout.hold(holding, point.x, point.y)
        schedule()
      }
      return
    }

    if (panning) {
      touched = true
      camera = {
        x: camera.x - (event.clientX - lastX) / camera.scale,
        y: camera.y - (event.clientY - lastY) / camera.scale,
        scale: camera.scale,
      }
      travelled += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
      schedule()
      return
    }

    const node = at(event)
    if (node === hovered) return

    hovered = node
    relight(node)
    schedule()
  }

  function onPointerUp(event: PointerEvent) {
    const wasHolding = holding
    const wasClick = travelled <= A_CLICK

    holding = -1
    panning = false
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    if (wasHolding >= 0 && wasClick) open(wasHolding, false)
  }

  function onDoubleClick() {
    if (clicked) onopen?.(clicked, true)
  }

  function open(node: number, keep: boolean) {
    // A node standing for a note the space does not hold has nothing to open.
    const path = graph.nodes[node]?.path
    if (!path) return

    clicked = path
    onopen?.(path, keep)
  }

  function onWheel(event: WheelEvent) {
    const surface = canvas
    if (!surface) return

    event.preventDefault()
    touched = true
    const box = surface.getBoundingClientRect()
    camera = zoomed(
      camera,
      width,
      height,
      event.clientX - box.left,
      event.clientY - box.top,
      Math.exp(-event.deltaY * 0.0015),
    )
    schedule()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !onescape) return

    // Only one graph is on screen at a time - the panel shows its lists while a
    // graph tab is open, having no note to be about - so this is the only thing
    // Escape can mean, except where there is text being typed: the palette and
    // every sheet close on Escape from their own field.
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
    if (focused instanceof HTMLElement && focused.isContentEditable) return

    onescape()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- A picture, and one that answers the pointer: there is nothing inside a canvas
     to hang an element on, so the interaction lives on the canvas itself. -->
<div class="graph" bind:this={host}>
  <canvas
    bind:this={canvas}
    class:panning
    aria-label={t('Graph')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => {
      if (hovered < 0) return
      hovered = -1
      relight(-1)
      schedule()
    }}
    ondblclick={onDoubleClick}
  ></canvas>
</div>

<style>
  .graph {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The picture is the thing being touched, so a drag on it must not start a
       text selection or the browser's own panning. */
    touch-action: none;
    user-select: none;
    cursor: default;
  }

  canvas.panning {
    cursor: grabbing;
  }
</style>
