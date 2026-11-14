<script lang="ts">
  import { tick, untrack } from 'svelte'
  import FindBar from './FindBar.svelte'
  import { keyElsewhere } from './layer-keys'
  import { menu } from './menu.svelte'
  import { modes } from './modes.svelte'
  import { inlineFiles } from './reading/drawn'
  import { paint, placesIn, rangeOf, wordsOf, type Words } from './reading/find'
  import { headingOffsets, positionOf, type Section, sectionAt } from './reading/places'
  import { readingHtml, tagAnchor, unreadableHtml } from './reading/render'
  import { trustsHtmlIn } from './sharing.svelte'
  import { scrollbar } from './ui-kit/src/api'
  import { shortcuts } from './shortcuts.svelte'
  import { followHref, MIDDLE, opensLink } from './open-link'
  import { tabAsk } from './new-tab'
  import { theme } from './theme/src/api'
  import { workspace, type Tab } from './workspace.svelte'
  import { loadEmbed, resolveFile, resolveNote, resolveRelative } from '@orden/editor'
  import {
    blockIds,
    decodeFragment,
    decodeTarget,
    isTabFile,
    pageFragment,
  } from '@orden/markdown/links'
  import { links } from './link-index.svelte'
  import { pressRow } from './query-block'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  const REDRAW = 200

  let scroller = $state<HTMLDivElement>()
  let root = $state<HTMLDivElement>()
  let surface = $state<HTMLElement>()
  let html = $state('')

  let latest = 0
  let redraw: ReturnType<typeof setTimeout> | undefined
  let drawn = false

  let undrawn: (() => void) | undefined

  function basesIn(page: HTMLElement, from: string | null): () => void {
    if (__EVEN_PLUGIN__ || !page.querySelector('[data-base-code], .embed-file[data-kind="base"]'))
      return () => undefined
    let stop: (() => void) | null = null
    let stopped = false
    void import('./views/mount').then(({ mountBases }) => {
      if (stopped) return
      stop = mountBases(
        page,
        from,
        untrack(() => tab.note.shared !== null),
      )
      changed()
      if (untrack(() => finding)) reveal()
    })
    return () => {
      stopped = true
      stop?.()
    }
  }

  const asks = $derived(tab.doc.includes('```query') || tab.doc.includes('```tasks'))

  function note() {
    return untrack(() => {
      tab.note.flush()
      return { text: tab.doc, path: tab.path }
    })
  }

  async function draw() {
    const mine = ++latest
    const source = note()
    const next = await readingHtml(source, theme.current, trustsHtmlIn(tab.note), tagAnchor).catch(
      (error: unknown) => {
        console.error('the note could not be rendered', error)
        return unreadableHtml(source.text)
      },
    )
    if (mine !== latest) return

    html = next

    await tick()
    changed()
    requestAnimationFrame(() => {
      if (mine !== latest) return
      show(untrack(() => tab.anchor) ?? 0)

      undrawn?.()
      const papers = surface
        ? inlineFiles(
            surface,
            untrack(() => workspace.rootHolding(tab.path)),
          )
        : undefined
      const bases = surface
        ? basesIn(
            surface,
            untrack(() => tab.path),
          )
        : undefined
      undrawn = () => {
        papers?.()
        bases?.()
      }
      if (untrack(() => finding)) reveal()
    })
  }

  $effect(() => {
    const reasons = [
      tab.note.revision,
      theme.current,
      trustsHtmlIn(tab.note),
      asks ? links.version : 0,
      links.locksSeen(),
      modes.hardBreaks,
    ]
    if (!reasons.length) return

    if (!drawn) {
      drawn = true
      void draw()
      return
    }

    clearTimeout(redraw)
    redraw = setTimeout(() => void draw(), REDRAW)
    return () => clearTimeout(redraw)
  })

  const style = $derived(`--measure: ${modes.width}rem; --leading-content: ${modes.lineHeight}`)
  const direction = $derived(modes.rtl ? 'rtl' : 'ltr')

  function headings(): { elements: HTMLElement[]; offsets: number[] } {
    const page = surface
    const offsets = page ? headingOffsets(tab.doc) : []
    if (!page) return { elements: [], offsets: [] }

    const elements = [...page.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && /^H[1-6]$/.test(child.tagName) && !!child.id,
    )

    return elements.length === offsets.length
      ? { elements, offsets }
      : { elements: [], offsets: [] }
  }

  function show(position: number) {
    const box = scroller
    const { elements, offsets } = headings()
    if (!box) return

    const { index, fraction } = sectionAt(position, offsets, tab.doc.length)
    const target = elements[index]
    if (!target) {
      box.scrollTop = 0
      return
    }

    target.scrollIntoView({ block: 'start' })
    if (!fraction) return

    const next = elements[index + 1]
    if (!next) return

    const from = target.getBoundingClientRect().top
    const to = next.getBoundingClientRect().top
    box.scrollTop = Math.max(
      0,
      Math.min(box.scrollTop + (to - from) * fraction, box.scrollHeight - box.clientHeight),
    )
  }

  function placeNow(): { section: Section; offsets: number[] } {
    const box = scroller
    const page = surface
    const { elements, offsets } = headings()
    if (!box || !page || !elements.length) return { section: { index: -1, fraction: 0 }, offsets }

    const edge = box.getBoundingClientRect()
    const found = document.elementFromPoint(edge.left + edge.width / 2, edge.top + 1)

    let block = found instanceof HTMLElement ? found : null
    while (block && block.parentElement !== page) block = block.parentElement
    if (!block) return { section: { index: -1, fraction: 0 }, offsets }

    const blocks = [...page.children]
    const where = blocks.indexOf(block)
    let index = -1
    for (let one = 0; one < elements.length; one++) {
      const element = elements[one]
      if (!element || blocks.indexOf(element) > where) break
      index = one
    }

    const target = elements[index]
    const next = elements[index + 1]
    if (!target || !next) return { section: { index, fraction: 0 }, offsets }

    const from = target.getBoundingClientRect().top
    const to = next.getBoundingClientRect().top
    const span = to - from
    const fraction = span > 0 ? Math.min(1, Math.max(0, (edge.top - from) / span)) : 0

    return { section: { index, fraction }, offsets }
  }

  let scheduled = 0

  function moved() {
    if (scheduled) return

    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      const box = scroller
      if (!box) return

      const { section, offsets } = placeNow()
      workspace.notePlace(tab.id, box.scrollTop, positionOf(section, offsets, tab.doc.length))
    })
  }

  $effect(() => () => {
    cancelAnimationFrame(scheduled)
    latest++
    undrawn?.()
    undrawn = undefined
  })

  $effect(() => {
    if (focused) scroller?.focus({ preventScroll: true })
  })

  function follow(event: MouseEvent) {
    if (!opensLink(event)) return
    const middle = event.button === MIDDLE

    const card = middle ? null : (event.target as Element | null)?.closest('.embed-web')
    if (card instanceof HTMLElement && loadEmbed(card)) {
      event.preventDefault()
      return
    }

    if (!middle && pressRow(event.target)) {
      event.preventDefault()
      return
    }

    const tag = (event.target as Element | null)?.closest('a.tag[data-tag]')
    if (tag) {
      event.preventDefault()
      const name = tag.getAttribute('data-tag')
      if (name && !middle) void import('./tag-search').then(({ searchTag }) => searchTag(name))
      return
    }

    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    event.preventDefault()

    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
      followHref(href, event)
      return
    }

    const hash = href.indexOf('#')
    const target = written(hash === -1 ? href : href.slice(0, hash))
    const fragment = hash === -1 ? '' : href.slice(hash + 1)

    if (!target) {
      if (fragment && !middle) jump(fragment)
      return
    }
    const ask = tabAsk(event)

    const index = links.index(tab.path)
    const wiki = anchor.classList.contains('wikilink')

    if (isTabFile(target)) {
      const file = wiki ? target : resolveFile(index, target, 'markdown')
      if (file === null) return

      void workspace.followLink(
        {
          path: file,
          target,
          heading: null,
          block: null,
          page: pageFragment(fragment ? decodeFragment(fragment) : null),
        },
        ask,
        tab.path,
      )
      return
    }

    const found = wiki
      ? { path: target }
      : (resolveRelative(index, target) ?? resolveNote(index, target))
    if (!found) return

    const said = fragment ? decodeFragment(fragment) : null
    const block = said?.startsWith('^') ? said.slice(1) : null
    void workspace.followLink(
      {
        path: found.path,
        target,
        heading: block === null ? said : null,
        block,
        page: null,
      },
      ask,
      tab.path,
    )
  }

  $effect(() => {
    const asked = workspace.goto
    if (!asked || !html || workspace.active?.id !== tab.id || tab.path !== asked.path) return

    workspace.goto = null
    void tick().then(() => requestAnimationFrame(() => land(asked.line)))
  })

  function land(line: number) {
    const named = blockIds(tab.doc).find((one) => one.line === line)
    if (named) jump(`^${named.id}`)
    else show(offsetOf(line))
  }

  const offsetOf = (line: number) =>
    tab.doc.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0)

  function written(target: string): string {
    return decodeTarget(target)
  }

  function jump(fragment: string) {
    const page = surface
    if (!page) return

    const said = decodeFragment(fragment)
    const found = page.querySelector(`[id="${CSS.escape(said)}"]`)
    if (found) {
      const block = said.startsWith('^') ? found.closest('p, li, blockquote') : null
      ;(block ?? found).scrollIntoView({ block: 'start' })
      return
    }
    if (!said.startsWith('^')) return
    const line = blockIds(tab.doc).find((one) => one.id === said.slice(1))?.line
    if (line !== undefined) show(offsetOf(line))
  }

  function showMenu(event: MouseEvent) {
    menu.show(
      event,
      [
        {
          label: 'Copy',
          hint: shortcuts.hint('fixed.copy'),
          disabled: (getSelection()?.toString() ?? '') === '',
          run: () => void navigator.clipboard.writeText(getSelection()?.toString() ?? ''),
        },
        {
          label: 'Leave reading',
          hint: shortcuts.hint('app.reading'),
          run: () => workspace.toggleReading(tab.id),
        },
      ],
      { near: true },
    )
  }

  const painter = {}

  let finding = $state(false)
  let query = $state('')
  let current = $state(0)

  let words: Words | null = null

  let drawnPage = $state(0)

  function changed() {
    words = null
    drawnPage++
  }

  function wording(): Words {
    const page = surface
    if (!words && page) words = wordsOf(page)
    return words ?? { text: '', pieces: [] }
  }

  const found = $derived.by(() => {
    if (!finding || !query || !drawnPage) return []
    return placesIn(wording(), query)
  })

  function step(by: number) {
    if (!found.length) return

    current = (current + by + found.length) % found.length
    reveal()
  }

  let painting = 0

  function reveal() {
    cancelAnimationFrame(painting)
    painting = requestAnimationFrame(() => {
      painting = 0
      repaint()
    })
  }

  function repaint() {
    const words = wording()
    const ranges = found.flatMap((offset) => rangeOf(words, offset, query.length) ?? [])
    if (current >= ranges.length) current = 0
    const here = ranges[current]

    paint(painter, 'orden-find', ranges)
    paint(painter, 'orden-find-here', here ? [here] : [])

    const box = scroller
    if (!here || !box) return

    const top = here.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTop += top - box.clientHeight / 2
  }

  function typed(what: string) {
    query = what
    current = 0
    reveal()
  }

  function openFind() {
    finding = true
  }

  function closeFind() {
    finding = false
    query = ''
    cancelAnimationFrame(painting)
    painting = 0
    paint(painter, 'orden-find', [])
    paint(painter, 'orden-find-here', [])
    scroller?.focus({ preventScroll: true })
  }

  $effect(() => () => {
    cancelAnimationFrame(painting)
    paint(painter, 'orden-find', [])
    paint(painter, 'orden-find-here', [])
  })

  function onKeydown(event: KeyboardEvent) {
    if (!focused || event.defaultPrevented || keyElsewhere(event, root)) return

    if (shortcuts.pressed('edit.find', event)) {
      event.preventDefault()
      openFind()
    } else if (finding && event.key === 'Escape') {
      event.preventDefault()
      closeFind()
    } else if (finding && shortcuts.pressed('edit.find-next', event)) {
      event.preventDefault()
      step(1)
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="read" {style} bind:this={root}>
  {#if finding}
    <FindBar
      {query}
      count={found.length}
      {current}
      onstep={step}
      onclose={closeFind}
      onquery={typed}
    />
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="scroller orden-host"
    tabindex="-1"
    use:scrollbar={tab.id}
    bind:this={scroller}
    onscroll={moved}
    onclick={follow}
    onauxclick={follow}
    oncontextmenu={showMenu}
  >
    <article
      id={focused ? 'write' : undefined}
      class="page orden-write"
      dir={direction}
      aria-label={tab.shown}
      bind:this={surface}
    >
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the export uses -->
      {@html html}
    </article>
  </div>
</div>

<style>
  .read {
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
    overflow-x: hidden;
  }

  .page {
    animation: settle var(--dur-base) var(--ease-out);
  }

  :global(.page > *) {
    content-visibility: auto;
    contain-intrinsic-size: auto 110px;
  }

  :global(#write.page > :is(ul, ol) > li:first-child) {
    margin-top: 0;
  }

  :global(#write.page > :is(ul, ol) > li:last-child) {
    margin-bottom: 0;
  }

  @keyframes settle {
    from {
      opacity: 0;
    }
  }
</style>
