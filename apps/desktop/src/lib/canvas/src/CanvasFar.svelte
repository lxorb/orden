<script lang="ts">
  import type { Camera } from '../../camera/src/api'
  import { FarSheets, type FarPicture, farPictures, paintFar } from './far'
  import type { CanvasEdge, CanvasNode } from '@orden/markdown/canvas'
  import type { Box } from '../../plane/src/api'
  import type { Palette } from '../../plane/src/api'
  import { fileUrl } from '../../plane/src/api'
  import { account } from '../../accounts/src/api'
  import { pixelRatio } from '../../ui-controls/src/api'

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
    root,
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
    root: string | null
  } = $props()

  let element = $state<HTMLCanvasElement>()
  const ratio = $derived(Math.min(2, pixelRatio.now))

  let arrived = $state(0)
  const shelf = farPictures(
    () => (arrived += 1),
    () => !!account.accountToken,
  )

  const sheets = new FarSheets((wide, tall) => {
    const paper = document.createElement('canvas')
    paper.width = wide
    paper.height = tall
    return paper
  })

  function picture(file: string): FarPicture | null {
    return shelf(fileUrl(file, root), file)
  }

  function paint() {
    if (!element) return
    const waiting = paintFar(element, {
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
      font,
      picture,
      sheets,
    })
    if (waiting) later()
  }

  function later() {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }

  const follows = (..._values: unknown[]) => undefined

  const font = $derived.by(() => {
    follows(palette)
    return element ? getComputedStyle(element).fontFamily || 'sans-serif' : 'sans-serif'
  })

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
      font,
      arrived,
    )
    if (!element) return
    if (!painted) {
      painted = true
      paint()
      return
    }
    later()
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
    font-family: var(--font-content);
  }
</style>
