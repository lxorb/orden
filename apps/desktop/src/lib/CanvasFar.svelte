<script lang="ts">
  /** The plane from far away: every card a box and every connector a line, painted on
   *  one 2d canvas (#535).
   *
   *  Far out, a card's words are a few pixels high and nobody reads them, and a plane
   *  framed whole is every card in view at once: three thousand cards were three
   *  thousand elements to style, lay out and paint, and their markdown made into
   *  HTML, each time the plane opened, the cards were picked or moved, or an undo
   *  brought them back - seconds, for eight thousand. Here each is a rectangle in its
   *  colour, ringed where it is picked, with a bar or two where it has words, and a
   *  connector is a straight line between the sides it leaves and reaches; one paint
   *  of the lot, once a frame, whatever changed. Coming close enough to read makes
   *  them cards again (Canvas.svelte decides when).
   *
   *  Nothing here handles a pointer: what is under one is worked out from the plane
   *  itself (canvas/hit.ts), as it is for the cards, so picking, dragging, joining and
   *  writing go on as they do near. */

  import type { Camera } from './camera'
  import { paintFar } from './canvas/far'
  import type { CanvasEdge, CanvasNode } from './canvas/format'
  import type { Box } from './canvas/geometry'
  import type { Palette } from './canvas/paint'

  const {
    nodes,
    edges,
    picked,
    dimmed,
    skip,
    view,
    camera,
    originX,
    originY,
    width,
    height,
    palette,
  }: {
    nodes: readonly CanvasNode[]
    edges: readonly CanvasEdge[]
    picked: ReadonlySet<string>
    /** Whether all but what is picked is faded back ("narrow to selection"). */
    dimmed: boolean
    /** A card drawn as a card all the same - the one being written in - and so not
     *  painted under it. */
    skip: string | null
    /** The part of the plane worth painting. */
    view: Box
    camera: Camera
    /** Where plane 0,0 is on the canvas, in pixels. */
    originX: number
    originY: number
    width: number
    height: number
    palette: Palette
  } = $props()

  let element = $state<HTMLCanvasElement>()
  const ratio = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)

  function paint() {
    if (!element) return
    paintFar(element, {
      nodes,
      edges,
      picked,
      dimmed,
      skip,
      view,
      scale: camera.scale,
      originX,
      originY,
      width,
      height,
      palette,
      ratio,
    })
  }

  /** Reads values for their own sake, so the effect around them follows them. */
  const follows = (..._values: unknown[]) => undefined

  // Painted once a frame at most, after whatever changed: the camera, the plane, what
  // is picked, the theme.
  let frame = 0
  $effect(() => {
    follows(
      nodes,
      edges,
      picked,
      dimmed,
      skip,
      view,
      camera,
      originX,
      originY,
      width,
      height,
      palette,
    )
    if (!element) return
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  })

  $effect(() => () => {
    if (frame) cancelAnimationFrame(frame)
  })
</script>

<canvas
  class="far"
  bind:this={element}
  style:width="{width}px"
  style:height="{height}px"
  data-far
  aria-hidden="true"
></canvas>

<style>
  .far {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
</style>
