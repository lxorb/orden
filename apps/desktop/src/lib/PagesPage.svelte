<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { PageNode } from './canvas/format'
  import { t } from './i18n.svelte'
  import { closeUpOf, densityFor, type Part, paperOf } from './pages/paper'

  const {
    page,
    number,
    unit,
    notePath,
    root,
    shared = null,
    seen = null,
  }: {
    page: PageNode
    number: number
    unit: number
    notePath: string | null
    root: string | null
    shared?: string | null
    seen?: { x: number; y: number; width: number; height: number } | null
  } = $props()

  const LINES = 30
  const GRID = 19

  let paper = $state.raw<ImageBitmap | null>(null)
  let lost = $state(false)
  let sheet = $state<HTMLCanvasElement>()

  const backed = $derived(!!page.file && !!page.page)

  const wanted = $derived((typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) / unit)

  const density = $derived(densityFor(wanted))

  const CLOSE_UP = 160

  const STRETCH = 1.1

  let close = $state<HTMLCanvasElement>()
  let paperWide = $state(0)
  let closeUp = $state.raw<Part | null>(null)

  const part = $derived.by((): Part | null => {
    if (!backed || !paperWide || !seen || !page.width || !page.height) return null
    if (wanted <= (paperWide / page.width) * STRETCH) return null

    const left = Math.max(0, Math.floor(seen.x - page.x))
    const top = Math.max(0, Math.floor(seen.y - page.y))
    const right = Math.min(page.width, Math.ceil(seen.x + seen.width - page.x))
    const bottom = Math.min(page.height, Math.ceil(seen.y + seen.height - page.y))
    if (right <= left || bottom <= top) return null

    return {
      x: left / page.width,
      y: top / page.height,
      width: (right - left) / page.width,
      height: (bottom - top) / page.height,
    }
  })

  $effect(() => {
    const want = part
    if (!want) {
      closeUp = null
      return
    }

    const file = page.file
    const at = page.page
    if (!file || !at) return

    const across = page.width * wanted
    const leaving = new AbortController()
    const timer = setTimeout(() => {
      void closeUpOf({ file, note: notePath, root, shared }, at, want, across, leaving.signal).then(
        (image) => {
          if (!image) return
          if (leaving.signal.aborted || !close) {
            image.close()
            return
          }

          close.width = image.width
          close.height = image.height
          close.getContext('2d')?.drawImage(image, 0, 0)
          image.close()
          closeUp = want
        },
      )
    }, CLOSE_UP)

    return () => {
      clearTimeout(timer)
      leaving.abort()
    }
  })

  $effect(() => {
    if (!backed) return

    const file = page.file
    const at = page.page
    if (!file || !at) return

    const asking = tries
    const leaving = new AbortController()
    void paperOf({ file, note: notePath, root, shared }, at, leaving.signal, false, density).then(
      (drawn) => {
        if (leaving.signal.aborted || asking !== tries) return

        paper = drawn?.image ?? null
        lost = !drawn
      },
    )

    return () => leaving.abort()
  })

  let tries = $state(0)
  const RETRY = 5000
  const MOST_TRIES = 60

  $effect(() => {
    if (!lost || tries >= MOST_TRIES) return
    const timer = setTimeout(() => (tries += 1), RETRY)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    const element = sheet
    const image = paper
    if (!element || !image) return

    element.width = image.width
    element.height = image.height
    element.getContext('2d')?.drawImage(image, 0, 0)
    paperWide = image.width
  })

  onDestroy(() => (paper = null))

  const ruling = $derived.by(() => {
    switch (page.pattern) {
      case 'lines':
        return `repeating-linear-gradient(to bottom, transparent 0, transparent ${LINES - 1}px, var(--canvas-dot) ${LINES - 1}px, var(--canvas-dot) ${LINES}px)`
      case 'grid':
        return [
          `repeating-linear-gradient(to bottom, transparent 0, transparent ${GRID - 1}px, var(--canvas-dot) ${GRID - 1}px, var(--canvas-dot) ${GRID}px)`,
          `repeating-linear-gradient(to right, transparent 0, transparent ${GRID - 1}px, var(--canvas-dot) ${GRID - 1}px, var(--canvas-dot) ${GRID}px)`,
        ].join(', ')
      case 'dots':
        return `radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px)`
      case 'blank':
        return 'none'
    }
  })

  const ruled = $derived(page.pattern === 'dots' ? `${GRID}px ${GRID}px` : 'auto')
</script>

<div
  class="sheet"
  class:ruled={page.pattern !== 'blank'}
  style:left="{page.x}px"
  style:top="{page.y}px"
  style:width="{page.width}px"
  style:height="{page.height}px"
  style:background-image={ruling}
  style:background-size={ruled}
  style:--unit={unit}
  aria-hidden="true"
>
  {#if backed}
    <canvas bind:this={sheet} class:there={!!paper}></canvas>
    {#if part}
      <canvas
        bind:this={close}
        class="close"
        class:there={!!closeUp}
        style:left="{(closeUp?.x ?? 0) * 100}%"
        style:top="{(closeUp?.y ?? 0) * 100}%"
        style:width="{(closeUp?.width ?? 0) * 100}%"
        style:height="{(closeUp?.height ?? 0) * 100}%"
      ></canvas>
    {/if}
  {/if}
  {#if lost}
    <span class="missing">{t('The paper could not be read')}</span>
  {/if}
  <span class="number">{number}</span>
</div>

<style>
  .sheet {
    position: absolute;
    background-color: var(--surface);
    background-repeat: repeat;
    border: calc(1px * var(--unit)) solid var(--line);
    border-radius: calc(2px * var(--unit));
    box-shadow: 0 calc(1px * var(--unit)) calc(3px * var(--unit)) rgb(0 0 0 / 0.08);
    pointer-events: none;
    overflow: hidden;
  }

  .sheet canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .sheet canvas.there {
    opacity: 1;
  }

  .sheet canvas.close {
    inset: auto;
    transition: none;
  }

  .missing {
    position: absolute;
    inset-inline: 0;
    top: calc(12px * var(--unit));
    color: var(--muted);
    font: calc(12px * var(--unit)) / 1.4 var(--font-ui, inherit);
    text-align: center;
    user-select: none;
    -webkit-user-select: none;
  }

  .number {
    position: absolute;
    inset-inline-end: calc(10px * var(--unit));
    bottom: calc(6px * var(--unit));
    color: var(--muted);
    font: calc(11px * var(--unit)) / 1 var(--font-ui, inherit);
    opacity: 0.55;
    user-select: none;
    -webkit-user-select: none;
  }
</style>
