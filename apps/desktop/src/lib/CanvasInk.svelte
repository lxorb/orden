<script lang="ts">
  /** The ink on the plane, on two 2d canvases.
   *
   *  Two, because they change at different rates. The lower one holds everything
   *  already written and is repainted when the ink or the camera changes; the
   *  upper one holds the one stroke under the pen and is repainted on every
   *  pointer event. A pen event therefore costs one stroke's outline, whether the
   *  plane carries five strokes or five thousand.
   *
   *  Both are asked for a desynchronised context, which is a hint that the
   *  browser may take or leave. Where it is taken, the ink lands under the nib
   *  rather than a frame behind it.
   *
   *  Nothing here handles a pointer. The surface above owns every gesture and
   *  hands this component the stroke to draw, which is why these two elements can
   *  be `pointer-events: none` and never be in the way of a click. */

  import type { Camera } from './camera'
  import type { InkStroke } from './canvas/format'
  import { inkContext, type Palette, paintInk, paintLive, type View } from './canvas/paint'

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
    /** The stroke being drawn, while one is. */
    live?: InkStroke | null
    camera: Camera
    width: number
    height: number
    picked: ReadonlySet<string>
    /** What the six preset colours are, read off the theme. */
    palette: Palette
  } = $props()

  let below = $state<HTMLCanvasElement>()
  let above = $state<HTMLCanvasElement>()

  const ratio = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
  const view = $derived<View>({ camera, width, height, ratio })

  /** Repainted whenever the ink, the selection or the camera moves. A pan is a
   *  clear and a redraw of what is in view, which is a few hundred paths at
   *  most: see `paintInk`, which culls by each stroke's own box. */
  $effect(() => {
    const element = below
    if (!element || !width || !height) return

    const context = contextOf(element)
    if (context) paintInk(context, ink, view, palette, picked)
  })

  $effect(() => {
    const element = above
    if (!element || !width || !height) return

    const context = contextOf(element)
    if (context) paintLive(context, live, view, palette)
  })

  /** One context per element, kept: the attributes cannot be changed after the
   *  first call, so asking twice would silently hand back the first answer
   *  anyway. */
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D | null>()

  function contextOf(element: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const held = contexts.get(element)
    if (held !== undefined) return held

    const context = inkContext(element)
    contexts.set(element, context)
    return context
  }
</script>

<canvas
  class="ink"
  bind:this={below}
  width={Math.max(1, Math.round(width * ratio))}
  height={Math.max(1, Math.round(height * ratio))}
  style:width="{width}px"
  style:height="{height}px"
  aria-hidden="true"
></canvas>

<canvas
  class="ink live"
  bind:this={above}
  width={Math.max(1, Math.round(width * ratio))}
  height={Math.max(1, Math.round(height * ratio))}
  style:width="{width}px"
  style:height="{height}px"
  aria-hidden="true"
></canvas>

<style>
  /* Over the cards, because writing on a page goes on top of what is printed
     there, and out of the way of every pointer, because the surface above owns
     them all. */
  .ink {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 3;
  }

  .live {
    z-index: 4;
  }
</style>
