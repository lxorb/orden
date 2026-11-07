<script lang="ts">
  import { moved, removed, reshaped } from '@orden/markdown/pages'
  import type { Canvas } from './canvas/format'
  import { PAPER_NAMES, PATTERNS, type PageNode, type Paper, type Pattern } from './canvas/format'
  import { paintSketch } from './canvas/paint'
  import { readPalette } from './canvas/palette'
  import { carryPage, draggedPage, dropOver, isPageDrag } from './drag-paths'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { densityFor, paperOf } from './pages/paper'
  import { sameSheet, type SheetDrawn, sheetDrawn, shelvesOf, shownOf } from './pages/thumbs'
  import { pages as showing } from './pages/showing.svelte'
  import { ListView } from './row-window.svelte'
  import { roving } from './roving'
  import { workspace } from './workspace.svelte'

  const WIDE = 104

  const SETTLE = 600

  const follows = (_value: unknown) => undefined

  const FIRST = 24

  const LEAST = 88

  const store = $derived(showing.current?.store ?? null)
  const pages = $derived(store?.pages ?? [])

  let list = $state<HTMLUListElement>()
  let wide = $state(0)
  let gap = $state(8)
  const where = new ListView()

  const shelves = $derived(shelvesOf(pages, wide, { least: LEAST, gap, edge: 1 }))
  const view = $derived(
    wide > 0
      ? shownOf(shelves, pages.length, where.top, where.room || window.innerHeight)
      : { from: 0, to: Math.min(FIRST, pages.length), above: 0, below: 0 },
  )
  let holding = $state<string | null>(null)
  let letting = 0

  const pinned = $derived.by(() => {
    if (holding === null) return -1
    const at = pages.findIndex((one) => one.id === holding)
    return at < view.from || at >= view.to ? at : -1
  })

  const shown = $derived.by(() => {
    const out = pages.slice(view.from, view.to).map((page, index) => ({
      page,
      at: view.from + index,
      away: false,
    }))
    const away = pages[pinned]
    if (away)
      out.splice(pinned < view.from ? 0 : out.length, 0, { page: away, at: pinned, away: true })
    return out
  })

  function spotOf(at: number): { top: number; start: number; width: number } {
    const { columns, tops } = shelves
    const cell = Math.max(0, (wide - gap * (columns - 1)) / columns)
    return {
      top: tops[Math.floor(at / columns)] ?? 0,
      start: (at % columns) * (cell + gap),
      width: cell,
    }
  }

  function held(event: FocusEvent) {
    window.clearTimeout(letting)
    const row = (event.target as HTMLElement).closest<HTMLElement>('li[data-id]')
    holding = row?.dataset.id ?? null
  }

  function letFocusGo() {
    window.clearTimeout(letting)
    letting = window.setTimeout(() => {
      if (!list?.contains(document.activeElement)) holding = null
    })
  }

  $effect(() => () => window.clearTimeout(letting))

  $effect(() => {
    const ul = list
    if (!ul) return

    const measure = () => {
      wide = ul.clientWidth
      const said = Number.parseFloat(getComputedStyle(ul).rowGap)
      gap = Number.isFinite(said) ? said : 8
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(ul)
    const unfollow = where.follow(ul, () => 0)

    return () => {
      watch.disconnect()
      unfollow?.()
    }
  })
  const spaceRoot = $derived(workspace.rootHolding(store?.path ?? null))
  const on = $derived(store?.showing ?? 0)

  let over = $state<number | null>(null)
  let above = $state(true)

  let host = $state<HTMLElement>()
  let palette = $state<Record<string, string>>({})

  $effect(() => {
    const element = host
    if (element) palette = readPalette(element)
  })

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- painted into, never rendered from; see above
  const sheets = new Map<string, HTMLCanvasElement>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- which sheets are near the screen, not anything rendered
  const seen = new Set<string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the draws under way, not anything rendered
  const drawing = new Map<string, AbortController>()
  const painted = new WeakMap<HTMLCanvasElement, Canvas>()
  const drawnAs = new WeakMap<HTMLCanvasElement, SheetDrawn>()
  const inks = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

  const watcher =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(sighted, { rootMargin: '50% 0px' })

  $effect(() => () => {
    watcher?.disconnect()
    for (const one of drawing.values()) one.abort()
  })

  function sighted(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.page
      if (!id) continue

      if (!entry.isIntersecting) {
        seen.delete(id)
        drawing.get(id)?.abort()
        drawing.delete(id)
        continue
      }

      seen.add(id)
      const element = sheets.get(id)
      const page = pages.find((one) => one.id === id)
      if (element && page && painted.get(element) !== store?.canvas) void draw(page, element)
    }
  }

  function keep(id: string, element: HTMLCanvasElement | undefined) {
    const was = sheets.get(id)
    if (was && was !== element) watcher?.unobserve(was)
    if (element) {
      sheets.set(id, element)
      if (watcher) watcher.observe(element)
      else seen.add(id)
    } else {
      sheets.delete(id)
      seen.delete(id)
      drawing.get(id)?.abort()
      drawing.delete(id)
    }
  }

  async function draw(page: PageNode, element: HTMLCanvasElement) {
    const canvas = store?.canvas
    if (!canvas) return

    const sheet = sheetDrawn(page, canvas.ink, palette)
    const was = drawnAs.get(element)
    if (was && sameSheet(was, sheet)) {
      drawing.get(page.id)?.abort()
      drawing.delete(page.id)
      painted.set(element, canvas)
      return
    }

    drawing.get(page.id)?.abort()
    const asked = new AbortController()
    drawing.set(page.id, asked)

    const scale = WIDE / page.width
    const tall = page.height * scale
    const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    const wide = Math.max(1, Math.round(WIDE * ratio))
    const high = Math.max(1, Math.round(tall * ratio))
    if (element.width !== wide) element.width = wide
    if (element.height !== high) element.height = high

    const ctx = element.getContext('2d')
    if (!ctx) return

    const view = {
      camera: { x: page.x + page.width / 2, y: page.y + page.height / 2, scale },
      width: WIDE,
      height: tall,
      ratio,
    }

    const paper =
      page.file && page.page
        ? await paperOf(
            { file: page.file, note: store.path, root: spaceRoot },
            page.page,
            asked.signal,
            true,
            densityFor(scale * ratio),
          )
        : null
    if (asked.signal.aborted) return
    drawing.delete(page.id)
    painted.set(element, canvas)
    if (paper || !page.file || !page.page) drawnAs.set(element, sheet)
    else drawnAs.delete(element)

    const inked = paper ? (inks.get(element) ?? document.createElement('canvas')) : element
    if (paper) {
      inks.set(element, inked)
      if (inked.width !== element.width) inked.width = element.width
      if (inked.height !== element.height) inked.height = element.height
    }

    const into = paper ? inked.getContext('2d') : ctx
    if (into) paintSketch(into, sheet.ink, view, palette)

    if (!paper) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, element.width, element.height)
    ctx.drawImage(paper.image, 0, 0, element.width, element.height)
    ctx.drawImage(inked, 0, 0)
  }

  let timer = 0
  $effect(() => {
    follows(store?.canvas)
    follows(palette)

    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      for (const page of pages) {
        const element = seen.has(page.id) ? sheets.get(page.id) : undefined
        if (element) void draw(page, element)
      }
    }, SETTLE)

    return () => window.clearTimeout(timer)
  })

  function edit(next: Canvas) {
    store?.edit(next)
  }

  function add(after: string | null) {
    const at = store?.addPage(after) ?? 0
    if (at) store?.turnTo(at)
  }

  const WORDS: Record<Pattern, string> = {
    blank: 'Blank',
    lines: 'Lines',
    grid: 'Grid',
    dots: 'Dots',
  }

  const PAPER_WORDS: Record<Paper, string> = {
    a4: 'A4',
    letter: 'Letter',
    long: 'Long page',
  }

  function showMenu(event: MouseEvent, page: PageNode, at: number) {
    if (!store || store.readOnly) return
    menu.show(event, pageMenu(page), { title: t('Page {number}', { number: at + 1 }) })
  }

  function pageMenu(page: PageNode): MenuEntry[] {
    return [
      { label: t('Add a page after this'), run: () => add(page.id) },
      {
        label: t('Delete this page'),
        danger: true,
        disabled: pages.length < 2,
        run: () => {
          const canvas = store?.canvas
          if (canvas) edit(removed(canvas, page.id))
        },
      },
      DIVIDER,
      ...PAPER_NAMES.map((paper) => ({
        label: t(PAPER_WORDS[paper]),
        disabled: page.paper === paper,
        run: () => {
          const canvas = store?.canvas
          if (canvas) edit(reshaped(canvas, page.id, { paper }))
        },
      })),
      DIVIDER,
      ...PATTERNS.map((pattern) => ({
        label: t(WORDS[pattern]),
        disabled: page.pattern === pattern,
        run: () => {
          const canvas = store?.canvas
          if (canvas) edit(reshaped(canvas, page.id, { pattern }))
        },
      })),
    ]
  }

  function start(event: DragEvent, page: PageNode) {
    const note = store?.path
    if (note) carryPage(event.dataTransfer, { note, page: page.id })
  }

  function overPage(event: DragEvent, at: number) {
    if (!isPageDrag(event.dataTransfer) || store?.readOnly) return

    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    over = at
    above = event.clientY < box.top + box.height / 2
  }

  function drop(event: DragEvent, at: number) {
    const carried = draggedPage(event.dataTransfer)
    over = null
    if (!carried) return

    event.preventDefault()
    const canvas = store?.canvas
    const from = pages.findIndex((one) => one.id === carried.page)
    if (!canvas || carried.note !== store.path || from < 0) return

    const to = above ? at : at + 1
    edit(moved(canvas, carried.page, to > from ? to - 1 : to))
  }
</script>

{#if store}
  <div class="navigator" bind:this={host}>
    {#if store.outline.length}
      <ul class="contents" use:roving={{ rows: '.row', open: (row) => row.click() }}>
        {#each store.outline as part, index (index)}
          <li>
            <button
              class="nib-row is-short row"
              style:--level={part.level}
              onclick={() => store.turnToPaper(part.page)}
            >
              <span class="nib-row-label"><bdi>{part.title}</bdi></span>
              <span class="nib-row-meta">{part.page}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <ul
      class="sheets"
      bind:this={list}
      style:padding-block="{view.above}px {view.below}px"
      onfocusin={held}
      onfocusout={letFocusGo}
    >
      {#each shown as { page, at, away } (page.id)}
        {@const spot = away ? spotOf(at) : null}
        <li
          data-id={page.id}
          class:away
          style:top={spot ? `${spot.top}px` : undefined}
          style:inset-inline-start={spot ? `${spot.start}px` : undefined}
          style:width={spot ? `${spot.width}px` : undefined}
        >
          <button
            class="page"
            class:is-on={at + 1 === on}
            class:above={over === at && above}
            class:below={over === at && !above}
            draggable="true"
            aria-label={t('Page {number}', { number: at + 1 })}
            aria-current={at + 1 === on ? 'true' : undefined}
            onclick={() => store.turnTo(at + 1)}
            oncontextmenu={(event) => showMenu(event, page, at)}
            use:longPress={(event) => showMenu(event, page, at)}
            ondragstart={(event) => start(event, page)}
            use:dropOver={(event) => overPage(event, at)}
            ondragleave={() => (over = null)}
            ondragend={() => (over = null)}
            ondrop={(event) => drop(event, at)}
          >
            <canvas
              aria-hidden="true"
              data-page={page.id}
              style:aspect-ratio="{page.width} / {page.height}"
              bind:this={
                () => sheets.get(page.id),
                (element: HTMLCanvasElement | undefined) => keep(page.id, element)
              }
            ></canvas>
            <span class="number">{at + 1}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if store.canAdd}
      <button class="add" onclick={() => add(null)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {t('Add a page')}
      </button>
    {/if}
  </div>
{/if}

<style>
  .navigator {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .contents {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .contents .row {
    padding-inline-start: calc(var(--row-pad) + var(--level) * var(--row-indent));
    opacity: calc(1 - min(var(--level), 4) * 0.09);
  }

  .navigator ul.sheets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    position: relative;
  }

  .navigator li.away {
    position: absolute;
  }

  .page {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }

  .page canvas {
    display: block;
    width: 100%;
    border-radius: inherit;
  }

  .page .number {
    position: absolute;
    inset-inline-end: 3px;
    bottom: 2px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1;
  }

  .page.is-on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  @media (hover: hover) {
    .page:hover {
      border-color: var(--line-strong);
    }
  }

  .page.above::before,
  .page.below::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
  }

  .page.above::before {
    top: -3px;
  }

  .page.below::after {
    bottom: -3px;
  }

  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px dashed var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    cursor: pointer;
  }

  .add svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
