<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { PageNode } from './canvas/format'
  import { t } from './i18n.svelte'
  import {
    closeUpOf,
    densityFor,
    type Part,
    paperEdition,
    paperOf,
    type PaperView,
    viewOf,
    type Words,
    wordsInto,
  } from './pages/paper'
  import { boxOf, COLOURS, type Highlight, toViewport } from './pdf/highlights'
  import { wordsOfRuns } from './pdf/find'
  import { wordsEnd } from './pages/words-end'
  import { locate } from './reading/find'
  import { pixelRatio } from './pixel-ratio.svelte'

  const {
    page,
    number,
    unit,
    notePath,
    root,
    shared = null,
    seen = null,
    still = true,
    marks = [],
    selectable = false,
    sought = [],
    current = null,
    onfound,
  }: {
    page: PageNode
    number: number
    unit: number
    notePath: string | null
    root: string | null
    shared?: string | null
    seen?: { x: number; y: number; width: number; height: number } | null
    still?: boolean
    marks?: readonly Highlight[]
    selectable?: boolean
    sought?: readonly Sought[]
    current?: number | null
    onfound?: (box: { x: number; y: number; width: number; height: number }) => void
  } = $props()

  interface Sought {
    at: number
    length: number
  }

  const LINES = 30
  const GRID = 19

  let paper = $state.raw<ImageBitmap | null>(null)
  let lost = $state(false)
  let sheet = $state<HTMLCanvasElement>()

  const backed = $derived(!!page.file && !!page.page)

  const wanted = $derived(pixelRatio.now / unit)

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
    paperEdition({ file, note: notePath, root, shared })
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
    paperEdition({ file, note: notePath, root, shared })
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

  const WORDS_AFTER = 200

  let words = $state<HTMLDivElement>()
  let read = $state.raw<Words | null>(null)

  const inView = $derived(
    !seen ||
      (page.x < seen.x + seen.width &&
        page.x + page.width > seen.x &&
        page.y < seen.y + seen.height &&
        page.y + page.height > seen.y),
  )

  let wordsWanted = $state(false)

  $effect(() => {
    if (still && inView) wordsWanted = true
  })

  $effect(() => {
    const layer = words
    const file = page.file
    const at = page.page
    const wide = page.width
    if (!wordsWanted || !layer || !file || !at || !wide) return
    paperEdition({ file, note: notePath, root, shared })

    const leaving = new AbortController()
    const timer = setTimeout(() => {
      void wordsInto({ file, note: notePath, root, shared }, at, wide, layer, leaving.signal).then(
        (found) => {
          if (!leaving.signal.aborted) read = found
        },
      )
    }, WORDS_AFTER)

    return () => {
      clearTimeout(timer)
      leaving.abort()
      layer.replaceChildren()
      read = null
    }
  })

  $effect(() => {
    const layer = words
    if (layer && read) return wordsEnd(layer)
  })

  const hits = $derived.by(() => {
    const layer = words
    if (!read || !layer || !sought.length) return []

    const found = wordsOfRuns(read.runs, read.divs)
    const whole = layer.getBoundingClientRect()
    if (!whole.width || !whole.height) return []

    return sought.flatMap((one) => {
      const from = locate(found.pieces, one.at)
      const to = locate(found.pieces, one.at + one.length)
      if (!from || !to) return []

      const range = document.createRange()
      range.setStart(from.piece.node, Math.min(from.into, from.piece.node.length))
      range.setEnd(to.piece.node, Math.min(to.into, to.piece.node.length))
      return [...range.getClientRects()].map((box) => ({
        current: one.at === current,
        left: ((box.left - whole.left) / whole.width) * 100,
        top: ((box.top - whole.top) / whole.height) * 100,
        width: (box.width / whole.width) * 100,
        height: (box.height / whole.height) * 100,
      }))
    })
  })

  $effect(() => {
    const shown = hits.find((one) => one.current)
    if (!shown) return

    onfound?.({
      x: page.x + (shown.left / 100) * page.width,
      y: page.y + (shown.top / 100) * page.height,
      width: (shown.width / 100) * page.width,
      height: (shown.height / 100) * page.height,
    })
  })

  let view = $state.raw<PaperView | null>(null)

  $effect(() => {
    const file = page.file
    const at = page.page
    if (!marks.length || !file || !at) return

    let mine = true
    void viewOf({ file, note: notePath, root, shared }, at).then((found) => {
      if (mine) view = found
    })
    return () => {
      mine = false
    }
  })

  const shownMarks = $derived.by(() => {
    if (!view?.width || !view.height) return []
    const { width, height } = view
    const point = toViewport(view.transform)
    return marks.flatMap((mark) =>
      mark.quads.map((quad) => {
        const box = boxOf(quad, point)
        return {
          colour: COLOURS[mark.colour] ?? COLOURS[0],
          left: (box.left / width) * 100,
          top: (box.top / height) * 100,
          width: (box.width / width) * 100,
          height: (box.height / height) * 100,
        }
      }),
    )
  })

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
  {#each hits as hit, index (index)}
    <span
      class="hit"
      class:current={hit.current}
      style:left="{hit.left}%"
      style:top="{hit.top}%"
      style:width="{hit.width}%"
      style:height="{hit.height}%"
    ></span>
  {/each}
  {#if backed}
    <div class="words" class:live={selectable} bind:this={words}></div>
  {/if}
  {#each shownMarks as mark, index (index)}
    <span
      class="mark"
      style:left="{mark.left}%"
      style:top="{mark.top}%"
      style:width="{mark.width}%"
      style:height="{mark.height}%"
      style:background={mark.colour}
    ></span>
  {/each}
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

  .words {
    position: absolute;
    inset: 0;
    isolation: isolate;
    overflow: clip;
    text-align: initial;
    line-height: 1;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }

  .words :global(span),
  .words :global(br) {
    position: absolute;
    z-index: var(--z-raised);
    color: transparent;
    white-space: pre;
    transform-origin: 0 0;
  }

  .words > :global(:not(.markedContent)),
  .words :global(.markedContent span:not(.markedContent)) {
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  .words :global(.markedContent) {
    display: contents;
  }

  .words.live :global(span) {
    pointer-events: auto;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .words :global(.end) {
    position: absolute;
    inset: 100% 0 0;
    z-index: var(--z-base);
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
  }

  .words.live:global(.selecting) :global(.end) {
    top: 0;
    pointer-events: auto;
  }

  .words :global(::selection) {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .hit {
    position: absolute;
    border-radius: calc(1px * var(--unit));
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .hit.current {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
    outline: calc(1px * var(--unit)) solid var(--accent);
  }

  .mark {
    position: absolute;
    border-radius: calc(1px * var(--unit));
    opacity: 0.3;
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
