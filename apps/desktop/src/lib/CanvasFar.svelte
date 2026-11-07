<script lang="ts">
  import type { Camera } from './camera'
  import { paintFar } from './canvas/far'
  import type { CanvasEdge, CanvasNode } from './canvas/format'
  import type { Box } from './canvas/geometry'
  import type { Palette } from './canvas/paint'
  import { pixelRatio } from './pixel-ratio.svelte'

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
    dimmed: boolean
    skip: string | null
    view: Box
    camera: Camera
    originX: number
    originY: number
    width: number
    height: number
    palette: Palette
  } = $props()

  let element = $state<HTMLCanvasElement>()
  const ratio = $derived(Math.min(2, pixelRatio.now))

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

  const follows = (..._values: unknown[]) => undefined

  let frame = 0
  let painted = false
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
      ratio,
    )
    if (!element) return
    if (!painted) {
      painted = true
      paint()
      return
    }
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
