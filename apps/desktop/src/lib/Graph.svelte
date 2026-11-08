<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import GraphControls from './GraphControls.svelte'
  import type { NoteGraph } from './graph'
  import { neighbours, signature } from './graph-walk'
  import { Fingers } from './graph-fingers'
  import { graphFilter, type Keeps } from './graph-filter'
  import { Layout } from './graph-layout'
  import { howFor, type OpenHow, type TabAsk, tabAsk } from './new-tab'
  import { type Camera, framing, graphPoint, nodeAt, wheelPixels, zoomed } from './camera'
  import { type GraphColours, paint, radiusOf } from './graph-paint'
  import { t } from './i18n.svelte'
  import { stillness } from './motion'
  import { parseQuery } from '@orden/scan/search/query'
  import { relativeTo } from './space-paths'
  import { pixelRatio } from './pixel-ratio.svelte'
  import { theme } from './theme.svelte'
  import { workspace } from './workspace.svelte'
  import { MOST_GROUPS } from './workspace/graph-settings.svelte'

  const {
    graph,
    current = null,
    whole = false,
    focused = true,
    onopen,
    onescape,
  }: {
    graph: NoteGraph
    current?: string | null
    whole?: boolean
    focused?: boolean
    onopen?: ((path: string, how: OpenHow) => void) | undefined
    onescape?: (() => void) | undefined
  } = $props()

  if (!__EVEN_PLUGIN__) void import('./hints.svelte').then(({ hints }) => hints.dismiss('graph'))

  const A_FRAME = 6

  const A_SETTLE = 10

  const A_CLICK = 3

  const PADDING = 24

  const A_LAPSE = 6000

  let host = $state<HTMLElement>()
  let canvas = $state<HTMLCanvasElement>()

  let layout: Layout | null = null
  let radii = new Float64Array(0)
  let lit = new Uint8Array(0)
  let hiding = new Uint8Array(0)
  let tint = new Int8Array(0)
  let camera: Camera = { x: 0, y: 0, scale: 1 }
  let colours: GraphColours | null = null
  let width = 0
  let height = 0
  let ratio = 1
  let hovered = -1

  let frame = 0
  let touched = false
  let panning = $state(false)
  let holding = -1
  let clicked: string | null = null
  let lastX = 0
  let lastY = 0
  let travelled = 0
  const fingers = new Fingers()

  let carding = $state(false)
  let at = $state<number | null>(null)
  let playing = $state(false)
  let started = 0
  let startedAt = 0

  const settings = $derived(workspace.graphSettings.here)

  const asked = $derived(whole ? settings.filter.trim() : '')

  const filter = $derived<Keeps | null>(asked ? graphFilter(parseQuery(asked)) : null)

  const groups = $derived(
    settings.groups.flatMap((group) => {
      const keeps = group.query.trim() ? graphFilter(parseQuery(group.query)) : null
      if (!keeps) return []
      return [{ colour: Math.min(MOST_GROUPS, Math.max(1, Math.round(group.colour))) - 1, keeps }]
    }),
  )

  const madeAt = $derived.by((): Map<string, number> => {
    const root = whole ? (workspace.activeSpace?.root ?? null) : null
    if (root === null) return new Map()

    return new Map(
      workspace.files
        .filter((file) => file.created > 0)
        .map((file) => [relativeTo(root, file.path), file.created]),
    )
  })

  const span = $derived.by((): { from: number; to: number } | null => {
    let from = Infinity
    let to = -Infinity

    for (const node of graph.nodes) {
      const made = node.path === null ? 0 : (madeAt.get(node.path) ?? 0)
      if (!made) continue
      if (made < from) from = made
      if (made > to) to = made
    }

    return from <= to && from !== to ? { from, to } : null
  })

  const shape = $derived(signature(graph))

  const currentAt = $derived(
    current === null ? -1 : graph.nodes.findIndex((node) => node.id === current),
  )

  const pushedBy = $derived(
    [settings.spread, settings.gather, settings.distance, settings.push].join('\n'),
  )

  const arrangedBy = $derived(`${pushedBy}\n${shape}`)

  const follows = (_value: unknown) => undefined

  $effect(() => {
    follows(arrangedBy)
    untrack(rebuild)
  })

  $effect(() => {
    follows(filter)
    follows(groups)
    follows(settings.orphans)
    follows(settings.sized)
    follows(madeAt)
    follows(at)
    untrack(remask)
    schedule()
  })

  $effect(() => {
    follows(settings.arrows)
    follows(settings.lines)
    follows(settings.fade)
    schedule()
  })

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

    follows(pixelRatio.now)
    const watcher = new ResizeObserver(() => resize())
    watcher.observe(element)
    resize()

    return () => watcher.disconnect()
  })

  $effect(() => {
    const element = canvas
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  let laidOut: { graph: NoteGraph; by: string } | null = null

  function placed(): Map<string, { x: number; y: number }> | undefined {
    const was = laidOut
    const held = layout
    if (!was || !held || was.by !== pushedBy) return undefined

    return new Map(
      was.graph.nodes.map((node, one) => [node.id, { x: held.x[one] ?? 0, y: held.y[one] ?? 0 }]),
    )
  }

  function rebuild() {
    const from = placed()
    layout = new Layout(graph, {
      spread: settings.spread,
      gather: settings.gather,
      distance: settings.distance,
      push: settings.push,
      from,
    })
    laidOut = { graph, by: pushedBy }
    lit = new Uint8Array(graph.nodes.length)
    hovered = -1
    remask()

    settling = stillness()

    if (!from) touched = false
    if (!touched) frameGraph()
    schedule()
  }

  let settling = false

  function remask() {
    const nodes = graph.nodes
    const edges = graph.edges
    const dates = madeAt
    const colours = groups
    const keeps = filter
    const sized = settings.sized

    const count = nodes.length
    if (hiding.length !== count) hiding = new Uint8Array(count)
    if (tint.length !== count) tint = new Int8Array(count)
    if (radii.length !== count) radii = new Float64Array(count)

    const cut = at
    const orphans = !whole || settings.orphans

    for (let one = 0; one < count; one++) {
      const node = nodes[one]
      if (!node) continue

      const made = node.path === null ? 0 : (dates.get(node.path) ?? 0)

      const yet = cut === null || made === 0 || made <= cut
      const kept = !keeps || keeps(node)
      hiding[one] = yet && kept && (orphans || node.degree > 0) ? 1 : 0

      radii[one] = radiusOf(sized ? node.degree : 0)

      let colour = -1
      for (const group of colours) {
        if (!group.keeps(node)) continue
        colour = group.colour
        break
      }
      tint[one] = colour
    }

    for (let one = 0; one < count; one++) {
      if (nodes[one]?.path === null) hiding[one] = 0
    }

    for (const edge of edges) {
      if (nodes[edge.a]?.path === null && hiding[edge.b]) hiding[edge.a] = 1
      if (nodes[edge.b]?.path === null && hiding[edge.a]) hiding[edge.b] = 1
    }
  }

  function frameGraph() {
    if (!layout) return
    camera = framing(layout.x, layout.y, graph.nodes.length, width, height, PADDING, hiding)
  }

  function resize() {
    const element = host
    const surface = canvas
    if (!element || !surface) return

    const box = element.getBoundingClientRect()
    ratio = untrack(() => pixelRatio.now)
    const next = { width: Math.round(box.width), height: Math.round(box.height) }
    if (!next.width || !next.height) return

    width = next.width
    height = next.height
    surface.width = Math.round(width * ratio)
    surface.height = Math.round(height * ratio)

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

    if (settling) {
      if (!arrangement.settle(A_SETTLE)) {
        schedule()
        return
      }

      settling = false
      if (!touched) frameGraph()
      draw()
      return
    }

    const until = performance.now() + A_FRAME
    while (!arrangement.settled && performance.now() < until) arrangement.tick()
    if (playing) step()
    if (!arrangement.settled || playing) schedule()

    if (!touched) frameGraph()
    draw()
  }

  function step() {
    const one = span
    if (!one) {
      playing = false
      return
    }

    const gone = (performance.now() - started) / A_LAPSE
    const next = startedAt + (one.to - one.from) * gone

    if (next >= one.to) {
      at = null
      playing = false
      return
    }

    at = next
  }

  function play() {
    const one = span
    if (!one) return

    if (playing) {
      playing = false
      return
    }

    startedAt = at ?? one.from
    started = performance.now()
    playing = true
    schedule()
  }

  function scrub(moment: number) {
    playing = false
    at = moment >= (span?.to ?? 0) ? null : moment
    schedule()
  }

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
      groups: Array.from({ length: MOST_GROUPS }, (_one, index) => {
        return token(`--canvas-${index + 1}`) || '#888888'
      }),
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
      shown: hiding,
      tint,
      arrows: settings.arrows,
      lines: settings.lines,
      fade: settings.fade,
      ratio,
    })
  }

  function relight(node: number) {
    lit.fill(0)
    if (node < 0) return

    lit[node] = 2
    for (const near of neighbours(graph, node)) lit[near] ||= 1
  }

  function nodeUnder(event: PointerEvent | MouseEvent): number {
    const surface = canvas
    if (!surface || !layout) return -1

    const box = surface.getBoundingClientRect()
    const found = nodeAt(
      layout.x,
      layout.y,
      radii,
      camera,
      width,
      height,
      event.clientX - box.left,
      event.clientY - box.top,
    )

    return found >= 0 && hiding[found] ? found : -1
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button === 1) {
      const node = nodeUnder(event)
      if (node < 0) return
      event.preventDefault()
      open(node, tabAsk(event))
      return
    }
    if (event.button !== 0) return

    canvas?.setPointerCapture(event.pointerId)
    fingers.press(event.pointerId, { x: event.clientX, y: event.clientY })
    if (fingers.pinching) {
      holding = -1
      panning = false
      travelled = Infinity
      return
    }
    if (fingers.lead !== event.pointerId) return

    lastX = event.clientX
    lastY = event.clientY
    travelled = 0

    const node = nodeUnder(event)
    if (node >= 0) holding = node
    else panning = true
  }

  function onPointerMove(event: PointerEvent) {
    const surface = canvas
    if (!surface) return

    const pinched = fingers.move(event.pointerId, { x: event.clientX, y: event.clientY })
    if (fingers.pinching) {
      if (!pinched) return
      touched = true
      const box = surface.getBoundingClientRect()
      const moved = {
        ...camera,
        x: camera.x - pinched.dx / camera.scale,
        y: camera.y - pinched.dy / camera.scale,
      }
      camera = zoomed(
        moved,
        width,
        height,
        pinched.at.x - box.left,
        pinched.at.y - box.top,
        pinched.by,
      )
      schedule()
      return
    }
    if (fingers.lead !== null && fingers.lead !== event.pointerId) return

    if ((holding >= 0 || panning) && event.buttons === 0) {
      holding = -1
      panning = false
      fingers.lift(event.pointerId)
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
    }

    if (holding >= 0 && layout) {
      travelled += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY

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

    const node = nodeUnder(event)
    if (node === hovered) return

    hovered = node
    relight(node)
    schedule()
  }

  function onPointerUp(event: PointerEvent) {
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    const leading = fingers.lead === event.pointerId
    const left = fingers.lift(event.pointerId)
    if (left) {
      holding = -1
      panning = true
      lastX = left.x
      lastY = left.y
      return
    }
    if (!leading && fingers.lead !== null) return

    const wasHolding = holding
    const wasClick = travelled <= A_CLICK

    holding = -1
    panning = false

    if (event.type === 'pointerup' && wasHolding >= 0 && wasClick) open(wasHolding, tabAsk(event))
  }

  function onDoubleClick(event: MouseEvent) {
    if (clicked && tabAsk(event) === 'plain') onopen?.(clicked, {})
  }

  function open(node: number, ask: TabAsk) {
    const path = graph.nodes[node]?.path
    if (!path) return

    clicked = path
    onopen?.(path, howFor(ask, { preview: true }))
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
      Math.exp(-wheelPixels(event).y * 0.0015),
    )
    schedule()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || !onescape) return

    const focus = document.activeElement
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement) return
    if (focus instanceof HTMLElement && focus.isContentEditable) return
    const bare = focus === null || focus === document.body
    if (!host?.contains(focus) && !(bare && focused)) return

    event.preventDefault()
    onescape()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="graph" tabindex="-1" bind:this={host}>
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

  {#if whole}
    <GraphControls
      open={carding}
      {span}
      at={at ?? span?.to ?? 0}
      {playing}
      onopen={(next: boolean) => (carding = next)}
      onplay={play}
      onscrub={scrub}
    />
  {/if}
</div>

<style>
  .graph {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    outline: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
  }

  canvas.panning {
    cursor: grabbing;
  }
</style>
