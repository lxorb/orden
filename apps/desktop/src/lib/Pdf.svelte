<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import { tick } from 'svelte'
  import { copyText } from './clipboard'
  import FindBar from './FindBar.svelte'
  import { t } from './i18n.svelte'
  import { type OpenPdf, openDocument, textOf } from './pdf/document'
  import { textOfRuns, wordsOfRuns } from './pdf/find'
  import { paperOpened, paperRead } from './pdf/papers'
  import {
    type Box,
    citation,
    emptySheet,
    frozen,
    type Highlight,
    joinRuns,
    quadOf,
    type Quad,
    type Sheet,
    toPdf,
    type Transform,
  } from './pdf/highlights'
  import {
    GAP,
    heightOf,
    heldZoom,
    nearby,
    nextZoom,
    pageAt,
    PDF_TO_CSS,
    stack,
    topOfPage,
    type Size,
  } from './pdf/pages'
  import { editHighlights, loadHighlights } from './pdf/sidecar'
  import { marksFromOutside } from './pdf/sheets.svelte'
  import PdfPage from './PdfPage.svelte'
  import { paint, placesOf, rangeOf } from './reading/find'
  import { scrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import { pdfOutlines, readOutline } from './pdf/outline.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  const LETTER: Size = { width: 612, height: 792 }

  const PATIENCE = 2000

  const OPENED = 'nib:pdf-open'

  let doc = $state<PDFDocumentProxy | null>(null)
  let broken = $state(false)
  let scroller = $state<HTMLDivElement>()

  let sizes = $state<(Size | undefined)[]>([])
  let fallback = $state<Size>(LETTER)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; the marks come off `sheet`
  const matrices = new Map<number, Transform>()

  let viewWidth = $state(0)
  const fitted = $derived.by(() => {
    if (!viewport.touch || viewWidth <= 0) return 1
    const widest = Math.max(fallback.width, ...sizes.map((size) => size?.width ?? 0))
    return Math.min(1, (viewWidth - GAP * 2) / (widest * PDF_TO_CSS))
  })
  const zoom = $derived(tab.zoom ?? fitted)
  const boxes = $derived(stack(sizes, fallback, zoom))
  const height = $derived(heightOf(boxes))

  let at = $state(0)
  let viewHeight = $state(0)

  const shown = $derived(nearby(boxes, at, viewHeight))
  const drawn = $derived(
    Array.from(
      { length: Math.max(0, shown.to - shown.from) },
      (_unused, index) => shown.from + index + 1,
    ),
  )
  const columnWidth = $derived(Math.max(0, ...boxes.map((box) => box.width)) + GAP * 2)

  let sheet = $state<Sheet>(emptySheet())
  let picked = $state<string | null>(null)

  const marksByPage = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const out = new Map<number, Highlight[]>()
    for (const mark of sheet.highlights) {
      const held = out.get(mark.page)
      if (held) held.push(mark)
      else out.set(mark.page, [mark])
    }
    return out
  })

  let opening = 0

  $effect(() => {
    const path = tab.path
    const id = tab.id
    if (path === null) return

    const mine = ++opening
    const current = () => mine === opening
    const asked = performance.now()
    let opened: OpenPdf | null = null

    const open = async () => {
      const held = await openDocument(path)
      if (!current()) {
        void held.close()
        return
      }
      opened = held

      const listed = workspace.files.find((one) => one.path === path)
      paperOpened(path, held.hash, listed?.modified ?? 0)

      const first = await held.doc.getPage(1)
      const view = first.getViewport({ scale: 1 })
      if (!current()) return

      fallback = { width: view.width, height: view.height }
      sizes = Array.from({ length: held.doc.numPages }, (_unused, index) =>
        index === 0 ? { width: view.width, height: view.height } : undefined,
      )
      doc = held.doc
      void readOutline(held.doc).then((rows) => {
        if (current()) pdfOutlines.set(id, rows)
      })

      performance.measure(OPENED, { start: asked, detail: { pages: held.doc.numPages } })
    }

    void open().catch(() => {
      if (current()) broken = true
    })

    return () => {
      opening++
      pdfOutlines.delete(id)
      doc = null
      matrices.clear()
      runs.clear()
      layers.clear()
      void opened?.close()
    }
  })

  $effect(() => {
    const path = tab.path
    if (path === null) return
    marksFromOutside(path)

    let mine = true
    void loadHighlights(path).then((found) => {
      if (mine) sheet = found
    })

    return () => {
      mine = false
    }
  })

  let landed = false

  $effect(() => {
    const box = scroller
    if (!doc || !box || landed || !boxes.length) return

    landed = true
    box.scrollTop = topOfPage(boxes, tab.page ?? 1)
    at = box.scrollTop
  })

  $effect(() => {
    const asked = workspace.gotoPage
    const box = scroller
    if (!asked || !box || asked.path !== tab.path || !boxes.length) return

    workspace.gotoPage = null
    landed = true
    box.scrollTop = topOfPage(boxes, asked.page)
    at = box.scrollTop
  })

  function measured(number: number, size: Size, matrix: Transform) {
    matrices.set(number, matrix)

    const held = sizes[number - 1]
    if (held?.width === size.width && held.height === size.height) return

    const next = [...sizes]
    next[number - 1] = size
    sizes = next
  }

  let frame = 0

  function moved() {
    if (frame) return

    frame = requestAnimationFrame(() => {
      frame = 0
      const box = scroller
      if (!box) return

      at = box.scrollTop
      workspace.notePdf(tab.id, pageAt(boxes, at, viewHeight), tab.zoom)
    })
  }

  $effect(() => () => cancelAnimationFrame(frame))

  $effect(() => {
    if (focused) scroller?.focus({ preventScroll: true })
  })

  async function zoomTo(next: number, anchor?: number) {
    const box = scroller
    const wanted = heldZoom(next)
    if (!box || !height) {
      workspace.notePdf(tab.id, tab.page ?? 1, wanted)
      return
    }

    const focus =
      anchor === undefined ? box.clientHeight / 2 : anchor - box.getBoundingClientRect().top
    const along = (box.scrollTop + focus) / height

    workspace.notePdf(tab.id, tab.page ?? 1, wanted)

    await tick()
    box.scrollTop = Math.max(0, along * heightOf(boxes) - focus)
    at = box.scrollTop
  }

  function wheeled(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return

    event.preventDefault()
    void zoomTo(zoom * Math.pow(0.999, event.deltaY), event.clientY)
  }

  let pinch: { apart: number; zoom: number } | null = null

  function pinched(event: TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]]
    if (event.touches.length !== 2 || !a || !b) {
      pinch = null
      return
    }

    const apart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (!pinch) pinch = { apart, zoom }
    else if (pinch.apart)
      void zoomTo(pinch.zoom * (apart / pinch.apart), (a.clientY + b.clientY) / 2)
  }

  interface Match {
    page: number
    offset: number
  }

  const painter = {}

  let finding = $state(false)
  let query = $state('')
  let current = $state(0)
  let matches = $state<Match[]>([])

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; the bar reads `matches`
  const runs = new Map<number, string[]>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the nodes these name are not something to render from
  const layers = new Map<number, { runs: readonly string[]; divs: readonly HTMLElement[] }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- promises, not anything on screen
  const waiting = new Map<number, () => void>()
  let searching = 0

  function words(number: number, found: readonly string[], divs: readonly HTMLElement[]) {
    layers.set(number, { runs: found, divs })
    if (!runs.has(number)) runs.set(number, [...found])
    if (tab.path) paperRead(tab.path, number, found)

    waiting.get(number)?.()
    waiting.delete(number)

    if (finding && matches[current]?.page === number) void reveal()
  }

  function forget(number: number) {
    layers.delete(number)
    matrices.delete(number)
    waiting.get(number)?.()
    waiting.delete(number)
  }

  async function runsOf(number: number): Promise<string[]> {
    const held = runs.get(number)
    if (held) return held

    const document = doc
    if (!document) return []

    const page = await document.getPage(number)
    const read = await textOf(page)
    page.cleanup()
    runs.set(number, read)
    if (tab.path) paperRead(tab.path, number, read)

    return read
  }

  async function search(wanted: string) {
    const token = ++searching
    matches = []
    current = 0

    const document = doc
    if (!wanted || !document) {
      paint(painter, 'nib-find', [])
      paint(painter, 'nib-find-here', [])
      return
    }

    let shownFirst = false

    for (let page = 1; page <= document.numPages; page++) {
      const found = placesOf(textOfRuns(await runsOf(page)), wanted).map((offset) => ({
        page,
        offset,
      }))
      if (token !== searching) return
      if (!found.length) continue

      matches = [...matches, ...found]
      if (!shownFirst) {
        shownFirst = true
        void reveal()
      }
    }
  }

  function layerOf(
    number: number,
  ): Promise<{ runs: readonly string[]; divs: readonly HTMLElement[] } | null> {
    const held = layers.get(number)
    if (held) return Promise.resolve(held)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(number)
        resolve(null)
      }, PATIENCE)

      waiting.set(number, () => {
        clearTimeout(timer)
        resolve(layers.get(number) ?? null)
      })
    })
  }

  async function reveal() {
    const match = matches[current]
    const box = scroller
    if (!match || !box) return

    const top = topOfPage(boxes, match.page)
    if (
      top + (boxes[match.page - 1]?.height ?? 0) < box.scrollTop ||
      top > box.scrollTop + box.clientHeight
    ) {
      box.scrollTop = top
      at = top
    }

    const layer = await layerOf(match.page)
    if (!layer || matches[current] !== match) return

    const page = wordsOfRuns(layer.runs, layer.divs)
    const here = rangeOf(page, match.offset, query.length)
    const all = matches
      .filter((one) => one.page === match.page)
      .flatMap((one) => rangeOf(page, one.offset, query.length) ?? [])

    paint(painter, 'nib-find', all)
    paint(painter, 'nib-find-here', here ? [here] : [])
    if (!here) return

    const offset = here.getBoundingClientRect().top - box.getBoundingClientRect().top
    if (offset < 0 || offset > box.clientHeight - 40) {
      box.scrollTop += offset - box.clientHeight / 2
      at = box.scrollTop
    }
  }

  function step(by: number) {
    if (!matches.length) return

    current = (current + by + matches.length) % matches.length
    void reveal()
  }

  function typed(what: string) {
    query = what
    void search(what)
  }

  function closeFind() {
    finding = false
    query = ''
    searching++
    matches = []
    paint(painter, 'nib-find', [])
    paint(painter, 'nib-find-here', [])
    scroller?.focus({ preventScroll: true })
  }

  $effect(() => () => {
    paint(painter, 'nib-find', [])
    paint(painter, 'nib-find-here', [])
  })

  let control = $state<{ x: number; y: number; page: number; text: string; quads: Quad[] } | null>(
    null,
  )

  function sheetOf(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement
    return element?.closest<HTMLElement>('[data-page]') ?? null
  }

  function selected() {
    const selection = getSelection()
    const text = selection?.toString() ?? ''
    if (!selection?.rangeCount || !text.trim()) {
      control = null
      return
    }

    const range = selection.getRangeAt(0)
    const page = sheetOf(range.commonAncestorContainer)
    const number = Number(page?.dataset.page ?? 0)
    const matrix = matrices.get(number)
    if (!page || !matrix) {
      control = null
      return
    }

    const box = page.getBoundingClientRect()
    const rects = [...range.getClientRects()]
    const runs = joinRuns(
      rects.map((rect): Box => ({
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      })),
    )
    if (!runs.length) {
      control = null
      return
    }

    const point = toPdf(matrix)
    const top = Math.min(...rects.map((rect) => rect.top))
    const middle =
      (Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) /
      2

    control = {
      x: Math.min(Math.max(middle, 60), window.innerWidth - 60),
      y: top,
      page: number,
      text,
      quads: runs.map((run) => quadOf(run, point)),
    }
  }

  $effect(() => {
    if (!viewport.touch) return

    let settling = 0
    const heard = () => {
      clearTimeout(settling)
      settling = window.setTimeout(() => {
        const selection = getSelection()
        const at = selection?.anchorNode ?? null
        if (!selection?.rangeCount || (at && scroller?.contains(at))) selected()
      }, 150)
    }

    document.addEventListener('selectionchange', heard)
    return () => {
      clearTimeout(settling)
      document.removeEventListener('selectionchange', heard)
    }
  })

  async function highlight() {
    const asked = control
    const path = tab.path
    if (!asked || path === null) return

    const mark: Highlight = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      page: asked.page,
      text: asked.text,
      quads: asked.quads,
      colour: 0,
      created: Date.now(),
    }

    sheet = { ...sheet, highlights: [...sheet.highlights, mark] }
    control = null
    getSelection()?.removeAllRanges()

    await editHighlights(path, (now) => ({ ...now, highlights: [...now.highlights, mark] }))
  }

  async function copyLink() {
    const asked = control
    const path = tab.path
    if (!asked || path === null) return

    control = null
    await copyText(citation(path.split(/[\\/]/).pop() ?? '', asked.page, asked.text))
  }

  async function remove(id: string) {
    const path = tab.path
    if (path === null) return

    sheet = { ...sheet, highlights: sheet.highlights.filter((one) => one.id !== id) }
    picked = null
    await editHighlights(path, (now) => ({
      ...now,
      highlights: now.highlights.filter((one) => one.id !== id),
    }))
  }

  function onKeydown(event: KeyboardEvent) {
    if (!focused) return

    if (shortcuts.pressed('edit.find', event)) {
      event.preventDefault()
      finding = true
      return
    }
    if (finding && event.key === 'Escape') {
      event.preventDefault()
      closeFind()
      return
    }
    if (finding && shortcuts.pressed('edit.find-next', event)) {
      event.preventDefault()
      step(1)
      return
    }
    if (event.key === 'Escape' && (picked || control)) {
      event.preventDefault()
      picked = null
      control = null
      return
    }
    if (picked && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      void remove(picked)
      return
    }

    if (!(event.ctrlKey || event.metaKey) || event.altKey) return

    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      void zoomTo(nextZoom(zoom, 1))
    } else if (event.key === '-') {
      event.preventDefault()
      void zoomTo(nextZoom(zoom, -1))
    } else if (event.key === '0') {
      event.preventDefault()
      void zoomTo(1)
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="pdf">
  {#if finding}
    <FindBar
      {query}
      count={matches.length}
      {current}
      onstep={step}
      onclose={closeFind}
      onquery={typed}
    />
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroller nib-host"
    tabindex="-1"
    use:scrollbar={tab.id}
    bind:this={scroller}
    bind:clientHeight={viewHeight}
    bind:clientWidth={viewWidth}
    onscroll={moved}
    onwheel={wheeled}
    onmouseup={selected}
    ontouchstart={pinched}
    ontouchmove={pinched}
    ontouchend={(event) => {
      pinched(event)
      selected()
    }}
  >
    {#if broken}
      <p class="trouble">{t('That PDF could not be opened')}</p>
    {:else}
      <div
        class="column"
        role="list"
        aria-label={t('Pages')}
        style:height="{height}px"
        style:min-width="{columnWidth}px"
      >
        {#if doc}
          {#each drawn as number (number)}
            {@const box = boxes[number - 1]}
            {#if box}
              <PdfPage
                {doc}
                {number}
                {box}
                {zoom}
                count={sizes.length}
                marks={marksByPage.get(number) ?? []}
                selected={picked}
                onmeasure={measured}
                onwords={words}
                onforget={forget}
                onpick={(id: string | null) => (picked = id)}
              />
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  {#if control}
    <div
      class="nib-bar nib-bar-at"
      role="toolbar"
      aria-label={t('What is selected')}
      style:left="{control.x}px"
      style:top="{control.y}px"
    >
      <button
        class="pen"
        title={t('Highlight')}
        aria-label={t('Highlight')}
        disabled={frozen(sheet)}
        onmousedown={(event: MouseEvent) => {
          // The selection has to survive the press, or there is nothing to mark.
          event.preventDefault()
        }}
        onclick={() => void highlight()}
      >
        <svg viewBox="0 0 14 14"
          ><path d="M2 11.5h10M3.2 9.2 9.6 2.8a1.7 1.7 0 0 1 2.4 2.4L5.6 11.6H3.2z" /></svg
        >
      </button>
      <button
        title={t('Copy a link')}
        aria-label={t('Copy a link')}
        onmousedown={(event: MouseEvent) => event.preventDefault()}
        onclick={() => void copyLink()}
      >
        <svg viewBox="0 0 14 14">
          <path
            d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
          />
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .pdf {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .scroller {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: auto;
    background: var(--content-inner, var(--surface));
  }

  .column {
    position: relative;
    width: 100%;
    margin: 0 auto;
  }

  .trouble {
    margin: var(--space-6) auto;
    max-width: 24rem;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .nib-bar svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pen svg path:first-child {
    stroke: var(--accent);
    stroke-width: 2.4;
  }

  .pen:hover svg path:first-child,
  .pen:active svg path:first-child {
    stroke: var(--accent-ink);
  }
</style>
