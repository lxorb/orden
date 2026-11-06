<script lang="ts">
  import { moved, removed, reshaped } from '@orden/markdown/pages'
  import type { Canvas } from './canvas/format'
  import { PAPER_NAMES, PATTERNS, type PageNode, type Paper, type Pattern } from './canvas/format'
  import { paintInk } from './canvas/paint'
  import { readPalette } from './canvas/palette'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { densityFor, paperOf } from './pages/paper'
  import { pages as showing } from './pages/showing.svelte'
  import { workspace } from './workspace.svelte'

  const WIDE = 104

  const SETTLE = 600

  const follows = (_value: unknown) => undefined

  const FIRST = 24

  const STEP = 48

  const store = $derived(showing.current?.store ?? null)
  const pages = $derived(store?.pages ?? [])

  let listed = $state(FIRST)
  const shown = $derived(pages.length > listed ? pages.slice(0, listed) : pages)

  $effect(() => {
    if (listed >= pages.length) return
    const timer = window.setTimeout(() => (listed += STEP), 0)
    return () => window.clearTimeout(timer)
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

    drawing.get(page.id)?.abort()
    const asked = new AbortController()
    drawing.set(page.id, asked)

    const scale = WIDE / page.width
    const tall = page.height * scale
    const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    element.width = Math.max(1, Math.round(WIDE * ratio))
    element.height = Math.max(1, Math.round(tall * ratio))

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

    const inked = paper ? document.createElement('canvas') : element
    if (paper) {
      inked.width = element.width
      inked.height = element.height
    }

    const into = paper ? inked.getContext('2d') : ctx
    if (into) paintInk(into, canvas.ink, view, palette)

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

  function start(event: DragEvent, at: number) {
    event.dataTransfer?.setData('application/nib-page', String(at))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function overPage(event: DragEvent, at: number) {
    if (!event.dataTransfer?.types.includes('application/nib-page')) return

    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    over = at
    above = event.clientY < box.top + box.height / 2
  }

  function drop(event: DragEvent, at: number) {
    const said = event.dataTransfer?.getData('application/nib-page')
    over = null
    if (said === undefined || said === '') return

    event.preventDefault()
    const from = Number(said)
    const page = pages[from]
    const canvas = store?.canvas
    if (!page || !canvas || Number.isNaN(from)) return

    const to = above ? at : at + 1
    edit(moved(canvas, page.id, to > from ? to - 1 : to))
  }
</script>

{#if store}
  <div class="navigator" bind:this={host}>
    <ul>
      {#each shown as page, at (page.id)}
        <li>
          <button
            class="page"
            class:is-on={at + 1 === on}
            class:above={over === at && above}
            class:below={over === at && !above}
            draggable="true"
            aria-label={t('Page {number}', { number: at + 1 })}
            aria-current={at + 1 === on ? 'true' : undefined}
            onclick={() => store.turnTo(at + 1)}
            oncontextmenu={(event) =>
              menu.show(event, pageMenu(page), { title: t('Page {number}', { number: at + 1 }) })}
            use:longPress={(event) =>
              menu.show(event, pageMenu(page), { title: t('Page {number}', { number: at + 1 }) })}
            ondragstart={(event) => start(event, at)}
            ondragover={(event) => overPage(event, at)}
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

    <button class="add" onclick={() => add(null)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {t('Add a page')}
    </button>
  </div>
{/if}

<style>
  .navigator {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .navigator ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
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
