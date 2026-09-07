<script lang="ts">
  /** A note as it reads: rendered, not written in.
   *
   *  The same page an export writes and a published blog serves, in the same
   *  column and at the same size the editor was using, so switching between the
   *  two is one page changing its skin rather than a jump to somewhere else. The
   *  writing surface carries Typora's `#write` id and so does this, which is what
   *  puts every rule in the theme - and in a reader's own custom.css - on both
   *  faces of a note at once.
   *
   *  Nothing here writes to the note. The tab it is given is the pane's view of
   *  the document, and the document may be being typed into in another pane; when
   *  it is, the page is drawn again once the typing pauses and the place is kept.
   */

  import { tick, untrack } from 'svelte'
  import FindBar from './FindBar.svelte'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { modes } from './modes.svelte'
  import { paint, placesOf, rangeOf, wordsOf, type Words } from './reading/find'
  import { type Anchor, headingOffsets, positionAt, topFor } from './reading/places'
  import { readingHtml } from './reading/render'
  import { scrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { openExternal } from './tauri'
  import { theme } from './theme.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import { resolveFile, resolveNote, resolveRelative } from '@nib/editor'
  import { isPdfTarget, pageFragment } from '@nib/markdown/links'
  import { links } from './link-index.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** How long after the last keystroke elsewhere the page is drawn again. Long
   *  enough that a burst of typing costs one render, short enough that the words
   *  arrive while the reader is still looking at them. */
  const REDRAW = 200

  let scroller = $state<HTMLDivElement>()
  let surface = $state<HTMLDivElement>()
  let html = $state('')

  /** Which render is the current one, so an older one that finishes later - the
   *  first, which waits for the diagram drawers to load - cannot overwrite it. */
  let latest = 0
  let redraw: ReturnType<typeof setTimeout> | undefined
  let drawn = false

  /** The note, read outside the reactive graph: flushing brings the words forward
   *  and reading them here as a dependency would set the render off again. */
  function note() {
    return untrack(() => {
      tab.note.flush()
      return { text: tab.doc, path: tab.path }
    })
  }

  async function draw() {
    const mine = ++latest
    const source = note()
    const next = await readingHtml(source, theme.current)
    if (mine !== latest) return

    html = next
    words = null
    at = -1

    // The page is measured only once the browser has laid it out.
    await tick()
    requestAnimationFrame(() => {
      if (mine === latest) show(untrack(() => tab.anchor) ?? 0)
    })
  }

  // The first page, and another whenever the words change while it is up - the
  // same note being typed into in another pane - or the scheme its diagrams were
  // drawn for changes.
  $effect(() => {
    // Read, not used: these are what this effect is watching for.
    const reasons = [tab.note.revision, theme.current]
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

  // The measure, the line height and the text size are the editor's settings, and
  // they reach a pane's editor by being written onto it; there is no editor here,
  // so they are written on straight. Zoom is at the root and needs nothing.
  const style = $derived(`--measure: ${modes.width}rem; --leading-content: ${modes.lineHeight}`)
  // The writing direction too: it is about the language a reader reads in, and a
  // note that is written right to left is read right to left.
  const direction = $derived(modes.rtl ? 'rtl' : 'ltr')

  /** Where the headings are, in the source and on the page. Taken again whenever
   *  the page has changed height, which is what a picture arriving, a wider
   *  column or a re-render all come down to. */
  let anchors: Anchor[] = []
  let at = -1

  function places(): Anchor[] {
    const page = surface
    if (!page) return []

    const height = page.offsetHeight
    if (height === at) return anchors

    at = height
    anchors = measure(page)
    return anchors
  }

  function measure(page: HTMLElement): Anchor[] {
    const offsets = headingOffsets(tab.doc)
    // The renderer's own headings, which are the ones with an id. A heading inside
    // an embedded note has none, and is no place in this note anyway.
    const headings = [...page.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && /^H[1-6]$/.test(child.tagName) && !!child.id,
    )

    const ends: Anchor[] = [
      { position: 0, top: 0 },
      { position: tab.doc.length, top: page.offsetTop + page.offsetHeight },
    ]

    // A page whose headings do not line up with the note's is one this cannot
    // read: an underlined heading, a heading indented into code, a note the
    // renderer read differently. The two ends still hold, and they are honest.
    if (!offsets.length || offsets.length !== headings.length) return ends

    const between = headings.flatMap((heading, index) => {
      const position = offsets[index]
      return position === undefined ? [] : [{ position, top: heading.offsetTop }]
    })

    return [ends[0], ...between, ends[1]].filter((one): one is Anchor => one !== undefined)
  }

  /** Puts the source at `position` at the top of the page. */
  function show(position: number) {
    const box = scroller
    if (!box) return

    const top = topFor(position, places())
    box.scrollTop = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight))
  }

  /** Where the page is, as a place in the note, recorded as it moves: the editor
   *  puts that place back when the note is written in again. Once a frame, since
   *  reading the layout is what costs. */
  let scheduled = 0

  function moved() {
    if (scheduled) return

    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      const box = scroller
      if (!box) return

      workspace.notePlace(tab.id, box.scrollTop, positionAt(box.scrollTop, places()))
    })
  }

  $effect(() => () => cancelAnimationFrame(scheduled))

  // The pane that is being read takes the keyboard, so Page Down, the arrows and
  // the find key all reach it the way they reach an editor.
  $effect(() => {
    if (focused) scroller?.focus({ preventScroll: true })
  })

  /** A link, as the reading view has to read it: a place on this page, a note in
   *  this space, or the web. */
  function follow(event: MouseEvent) {
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    event.preventDefault()

    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
      void openExternal(href)
      return
    }

    const hash = href.indexOf('#')
    const target = written(hash === -1 ? href : href.slice(0, hash))
    const fragment = hash === -1 ? '' : href.slice(hash + 1)

    // A `#fragment` on its own is a heading of this note, and the note is already
    // on the page.
    if (!target) {
      if (fragment) jump(fragment)
      return
    }

    // A wikilink already carries the note it resolved to; a markdown link carries
    // the path it was written as, which is read from where it was written.
    const index = links.index(tab.path)
    const wiki = anchor.classList.contains('wikilink')

    // A PDF opens in a tab of its own, at the page the link names.
    if (isPdfTarget(target)) {
      const file = wiki ? target : resolveFile(index, target, 'markdown')
      if (file === null) return

      void workspace.followLink({
        path: file,
        target,
        heading: null,
        block: null,
        page: pageFragment(fragment ? written(fragment) : null),
      })
      return
    }

    const found = wiki
      ? { path: target }
      : (resolveRelative(index, target) ?? resolveNote(index, target))
    if (!found) return

    void workspace.followLink({
      path: found.path,
      target,
      heading: fragment ? written(fragment) : null,
      block: null,
      page: null,
    })
  }

  /** A target as the name it stands for: what a note writes in a link is a URL. */
  function written(target: string): string {
    try {
      return decodeURI(target)
    } catch {
      return target
    }
  }

  /** Scrolls to a heading on this page, the way the browser would if it were
   *  allowed to navigate. */
  function jump(fragment: string) {
    const page = surface
    if (!page) return

    const found = page.querySelector(`[id="${CSS.escape(written(fragment))}"]`)
    found?.scrollIntoView({ block: 'start' })
  }

  /** Copying, and the way back out. What a right click on a page that cannot be
   *  written in has to offer, and nothing else. */
  function showMenu(event: MouseEvent) {
    menu.show(
      event,
      [
        {
          label: t('Copy'),
          hint: shortcuts.hint('fixed.copy'),
          disabled: (getSelection()?.toString() ?? '') === '',
          run: () => void navigator.clipboard.writeText(getSelection()?.toString() ?? ''),
        },
        {
          label: t('Leave reading'),
          hint: shortcuts.hint('app.reading'),
          run: () => workspace.toggleReading(tab.id),
        },
      ],
      { near: true },
    )
  }

  // ── Finding ────────────────────────────────────────────────────────

  let finding = $state(false)
  let query = $state('')
  let current = $state(0)

  /** The page's words, read once per render; see reading/find.ts. */
  let words: Words | null = null

  function wording(): Words {
    const page = surface
    if (!words && page) words = wordsOf(page)
    return words ?? { text: '', pieces: [] }
  }

  const found = $derived.by(() => {
    // The words come off the page rather than out of `html`, but it is `html` that
    // says the page has changed under them.
    if (!finding || !query || !html) return []
    return placesOf(wording().text, query)
  })

  function step(by: number) {
    if (!found.length) return

    current = (current + by + found.length) % found.length
    reveal()
  }

  /** Paints the places found and brings the current one into view; see
   *  `paint` in reading/find.ts for why they are painted and not selected. */
  function reveal() {
    const words = wording()
    const ranges = found.flatMap((offset) => rangeOf(words, offset, query.length) ?? [])
    const here = ranges[current]

    paint('nib-find', ranges)
    paint('nib-find-here', here ? [here] : [])

    const box = scroller
    if (!here || !box) return

    // Into the middle, and by the box's own scroll rather than scrollIntoView,
    // which would move whatever else on the page happens to be scrollable.
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
    paint('nib-find', [])
    paint('nib-find-here', [])
    scroller?.focus({ preventScroll: true })
  }

  // A page that has gone, or been drawn again, has no matches to paint.
  $effect(() => () => {
    paint('nib-find', [])
    paint('nib-find-here', [])
  })

  /** The reader's own find key, read off the window because there is no editor
   *  here to read it: an editor binding never reaches a pane without one. */
  function onKeydown(event: KeyboardEvent) {
    if (!focused) return

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

<div class="read" {style}>
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

  <!-- Focusable, so the keys that move a page reach it; nothing in it is a
       field, and the caret a focused element would show is not drawn. -->
  <!-- The click is listened for here rather than on each link, since the links
       arrive with the page. Every one of them is a real anchor, so Tab reaches it
       and Enter fires the very click this reads: there is no gesture here that a
       keyboard cannot make. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="scroller"
    tabindex="-1"
    use:scrollbar={tab.id}
    bind:this={scroller}
    onscroll={moved}
    onclick={follow}
    oncontextmenu={showMenu}
  >
    <div id="write" class="page" dir={direction} bind:this={surface}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the export uses -->
      {@html html}
    </div>
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

  .scroller:focus-visible {
    outline: none;
  }

  /* The page arrives rather than appearing, which is what makes the switch read
     as one note turning over instead of two notes swapping. */
  .page {
    animation: settle var(--dur-base) var(--ease-out);
  }

  @keyframes settle {
    from {
      opacity: 0;
    }
  }
</style>
