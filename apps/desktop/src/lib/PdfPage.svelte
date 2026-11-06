<script lang="ts">
  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
  import {
    boxOf,
    COLOURS,
    type Highlight,
    matrixOf,
    toViewport,
    type Transform,
  } from './pdf/highlights'
  import { t } from './i18n.svelte'
  import { PDF_TO_CSS, type PageBox, sheetFor, type Size } from './pdf/pages'
  import { pdfjs } from './pdf/document'

  const {
    doc,
    number,
    count,
    box,
    zoom,
    marks,
    selected,
    onmeasure,
    onwords,
    onforget,
    onpick,
  }: {
    doc: PDFDocumentProxy
    number: number
    count: number
    box: PageBox
    zoom: number
    marks: readonly Highlight[]
    selected: string | null
    onmeasure: (number: number, size: Size, matrix: Transform) => void
    onwords: (number: number, runs: readonly string[], divs: readonly HTMLElement[]) => void
    onforget: (number: number) => void
    onpick: (id: string | null) => void
  } = $props()

  const MOST_PIXELS = 16 * 1024 * 1024

  const DRAWN = 'nib:pdf-page'

  let canvas = $state<HTMLCanvasElement>()
  let words = $state<HTMLDivElement>()
  let matrix = $state<Transform | null>(null)

  const boxes = $derived.by(() => {
    const placed = matrix
    if (!placed) return []

    const point = toViewport(placed)
    return marks.map((mark) => ({
      mark,
      quads: mark.quads.map((quad) => boxOf(quad, point)),
    }))
  })

  let latest = 0

  $effect(() => {
    const sheet = canvas
    const layer = words
    const scale = zoom * PDF_TO_CSS
    if (!sheet || !layer) return

    const mine = ++latest
    const current = () => mine === latest
    const asked = performance.now()
    let render: RenderTask | null = null
    let page: PDFPageProxy | null = null

    const draw = async () => {
      const [library, view] = await Promise.all([pdfjs(), doc.getPage(number)])
      if (!current()) return
      page = view

      const at = view.getViewport({ scale })
      const placed = matrixOf(at.transform)
      matrix = placed
      onmeasure(number, { width: at.width / scale, height: at.height / scale }, placed)

      const context = sheet.getContext('2d', { alpha: false })
      if (!context) return

      const fit = sheetFor(at, MOST_PIXELS, window.devicePixelRatio || 1)
      sheet.width = fit.width
      sheet.height = fit.height

      render = view.render({ canvas: sheet, canvasContext: context, viewport: at, ...fit.drawn })
      await render.promise
      if (!current()) return

      performance.measure(DRAWN, { start: asked, detail: { page: number, zoom } })

      const content = await view.getTextContent()
      if (!current()) return

      layer.textContent = ''
      const text = new library.TextLayer({
        textContentSource: content,
        container: layer,
        viewport: at,
      })
      await text.render()
      if (!current()) {
        text.cancel()
        return
      }

      onwords(number, text.textContentItemsStr, text.textDivs)
    }

    void draw().catch(() => {
      // A cancelled render throws, and so does a page that turns out to be
      // broken. Neither is worth interrupting the reader for: the page stays
      // blank, and every other page still draws.
    })

    return () => {
      latest++
      onforget(number)
      render?.cancel()
      page?.cleanup()
      sheet.width = 0
      sheet.height = 0
      layer.textContent = ''
    }
  })

  function pick(event: MouseEvent & { currentTarget: HTMLElement }) {
    if ((getSelection()?.toString() ?? '') !== '') return

    const page = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - page.left
    const y = event.clientY - page.top

    const hit = boxes.find(({ quads }) =>
      quads.some(
        (one) =>
          x >= one.left && x <= one.left + one.width && y >= one.top && y <= one.top + one.height,
      ),
    )

    onpick(hit?.mark.id ?? null)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  class="sheet"
  role="listitem"
  aria-setsize={count}
  aria-posinset={number}
  aria-label={t('Page {number} of {count}', { number, count })}
  style:top="{box.top}px"
  style:width="{box.width}px"
  style:height="{box.height}px"
  style:--total-scale-factor={zoom * PDF_TO_CSS}
  data-page={number}
  onclick={pick}
>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>

  <div class="marks" aria-hidden="true">
    {#each boxes as { mark, quads } (mark.id)}
      {#each quads as quad, run (run)}
        <div
          class="mark"
          class:picked={mark.id === selected}
          style:left="{quad.left}px"
          style:top="{quad.top}px"
          style:width="{quad.width}px"
          style:height="{quad.height}px"
          style:background={COLOURS[mark.colour] ?? COLOURS[0]}
        ></div>
      {/each}
    {/each}
  </div>

  <div class="words" bind:this={words}></div>
</div>

<style>
  .sheet {
    position: absolute;
    left: 50%;
    translate: -50%;
    background: #fff;
    border-radius: 2px;
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-sm);
    contain: content;
    --scale-round-x: 1px;
    --scale-round-y: 1px;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .mark {
    position: absolute;
    border-radius: 1px;
    opacity: 0.3;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .mark.picked {
    opacity: 0.5;
    outline: 1px solid var(--accent);
  }

  .words {
    position: absolute;
    inset: 0;
    overflow: clip;
    text-align: initial;
    line-height: 1;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    z-index: var(--z-raised);
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }

  .words :global(span),
  .words :global(br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0 0;
    user-select: text;
    -webkit-user-select: text;
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
</style>
