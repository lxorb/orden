<script lang="ts">
  import { untrack } from 'svelte'
  import type { Camera } from '../../camera/src/api'
  import type { InkStroke } from '@orden/markdown/canvas'
  import { type InkMode, inkLayer, wantedInkMode } from './backing'
  import { type Palette, paintLive, type View } from '../../plane/src/api'
  import { InkTiles } from './tiles'
  import { pixelRatio } from '../../pixel-ratio.svelte'

  const {
    ink,
    live = null,
    camera,
    width,
    height,
    picked,
    palette,
  }: {
    ink: readonly InkStroke[]
    live?: InkStroke | null
    camera: Camera
    width: number
    height: number
    picked: ReadonlySet<string>
    palette: Palette
  } = $props()

  const MARGIN = 240

  const NEAREST = 0.55
  const FURTHEST = 1.8

  let below = $state<HTMLCanvasElement>()
  let above = $state<HTMLCanvasElement>()

  const ratio = $derived(Math.min(2, pixelRatio.now))

  const wide = $derived(Math.max(1, width + 2 * MARGIN))
  const tall = $derived(Math.max(1, height + 2 * MARGIN))

  let painted = $state.raw<Camera | null>(null)

  const shift = $derived.by(() => {
    if (!painted) return { x: 0, y: 0, k: 1 }

    const k = camera.scale / painted.scale
    return {
      x: (painted.x - camera.x) * camera.scale,
      y: (painted.y - camera.y) * camera.scale,
      k,
    }
  })

  let mode = $state<InkMode>(wantedInkMode())

  const tiles = new InkTiles()

  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D | null>()

  function contextOf(element: HTMLCanvasElement, wanted: InkMode): CanvasRenderingContext2D | null {
    const held = contexts.get(element)
    if (held !== undefined) return held

    const layer = inkLayer(element, wanted)
    const context = layer?.context ?? null
    contexts.set(element, context)

    if (wanted === 'latency' && layer?.mode !== 'latency') mode = 'plain'
    return context
  }

  function rasterise() {
    untrack(() => {
      const element = below
      if (!element || !width || !height) return

      const context = contextOf(element, 'plain')
      if (!context) return

      const view: View = { camera, width: wide, height: tall, ratio }
      const pending = tiles.paint(context, ink, view, palette, picked)
      painted = { ...camera }

      if (pending) {
        stillAt = moves
        filling ||= requestAnimationFrame(fill)
      }
    })
  }

  let filling = 0
  let stillAt = 0

  function fill() {
    filling = 0
    if (moves !== stillAt) {
      stillAt = moves
      filling = requestAnimationFrame(fill)
      return
    }

    rasterise()
  }

  let moves = 0
  let looking = 0

  function settle() {
    moves += 1
    if (looking) return

    const look = () => {
      const seen = moves
      looking = requestAnimationFrame(() => {
        if (moves !== seen) {
          look()
          return
        }

        looking = 0
        rasterise()
      })
    }

    look()
  }

  const follows = (_value: unknown) => undefined

  let everDrawn = false

  let edited = 0

  function redraw() {
    edited ||= requestAnimationFrame(() => {
      edited = 0
      rasterise()
    })
  }

  $effect(() => {
    follows(ink)
    follows(picked)
    follows(palette)
    follows(wide)
    follows(tall)
    follows(ratio)

    if (everDrawn) {
      redraw()
      return
    }

    everDrawn = true
    filling ||= requestAnimationFrame(fill)
  })

  $effect(() => {
    const now = camera
    const was = untrack(() => painted)

    if (!was) {
      rasterise()
      return
    }

    const k = now.scale / was.scale
    const dx = (was.x - now.x) * now.scale
    const dy = (was.y - now.y) * now.scale

    if (Math.abs(dx) > MARGIN || Math.abs(dy) > MARGIN || k < NEAREST || k > FURTHEST) {
      cancelAnimationFrame(looking)
      looking = 0
      rasterise()
      return
    }

    if (!dx && !dy && k === 1) return

    settle()
  })

  $effect(() => () => {
    cancelAnimationFrame(looking)
    cancelAnimationFrame(filling)
    cancelAnimationFrame(edited)
  })

  let inked = false

  $effect(() => {
    const element = above
    const one = live
    if (!element || (!one && !inked)) return

    const context = contextOf(element, mode)
    if (!context) return

    paintLive(context, one, { camera, width, height, ratio }, palette)
    inked = one !== null
  })
</script>

<canvas
  class="ink settled"
  bind:this={below}
  width={Math.round(wide * ratio)}
  height={Math.round(tall * ratio)}
  style:left="{-MARGIN}px"
  style:top="{-MARGIN}px"
  style:width="{wide}px"
  style:height="{tall}px"
  style:transform={shift.k === 1
    ? `translate(${shift.x}px, ${shift.y}px)`
    : `translate(${shift.x}px, ${shift.y}px) scale(${shift.k})`}
  aria-hidden="true"
></canvas>

{#key mode}
  <canvas
    class="ink live"
    bind:this={above}
    width={Math.max(1, Math.round(width * ratio))}
    height={Math.max(1, Math.round(height * ratio))}
    style:width="{width}px"
    style:height="{height}px"
    aria-hidden="true"
  ></canvas>
{/key}

<style>
  .ink {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: var(--z-drawn);
  }

  .settled {
    transform-origin: center;
    will-change: transform;
  }

  .live {
    z-index: var(--z-drawn);
  }
</style>
