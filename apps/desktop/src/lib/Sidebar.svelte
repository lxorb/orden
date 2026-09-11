<script lang="ts">
  import {
    carried,
    carrySection,
    dragged,
    draggedSection,
    isSectionDrag,
    isTreeDrag,
  } from './drag-paths'
  import { movesSection } from './sections'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { movesInto } from './move-targets'
  import { FILES_MARK, GRAPH_MARK, LINKS_MARK, OUTLINE_MARK, SEARCH_MARK } from './panel-marks'
  import { newSpace } from './space-actions'
  import { arriving } from './arriving.svelte'
  import { arrive, leave, segmented } from './slide'
  import { headingAt, lineOf } from './outline'
  import { bookmarkEntry, DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { roving } from './roving'
  import type { Panel, SortKey } from './workspace.svelte'
  import { scrollbar } from './scrollbar'
  import { workspace } from './workspace.svelte'
  import { DEEPEST } from './workspace/graph-settings.svelte'
  import { search, type SearchSort } from './search.svelte'
  import { SidebarWidth } from './sidebar-width.svelte'
  import { viewport } from './viewport.svelte'
  import Bookmarks from './Bookmarks.svelte'
  import Links from './Links.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import SidebarFoot from './SidebarFoot.svelte'
  import SidebarToggle from './SidebarToggle.svelte'
  import SpaceSwitcher from './SpaceSwitcher.svelte'
  import { dropTarget } from './drop-target.svelte'
  import Tree from './Tree.svelte'
  import { dur } from './motion'

  const {
    ongoto,
    onmovesection,
  }: {
    ongoto?: (line: number) => void
    /** Moves a whole section of the open note, by the two places in the outline
     *  it came from and landed on. The app owns the editor, so the edit is made
     *  there; see `moveSection` in sections.ts for what a section is. */
    onmovesection?: (from: number, to: number) => void
  } = $props()

  /** Lit while a drop would land in the space itself: over the empty stretch
   *  below the last row, and over a row at the top of the space, which stands for
   *  the space the way every row stands for the folder it sits in. One answer for
   *  the whole list; see drop-target.svelte.ts. */
  const rootDrop = $derived.by(() => {
    const root = workspace.activeSpace?.root
    return root !== undefined && dropTarget.lit(root)
  })

  /** The space below the tree lights only where a drop would do something: a row
   *  already at the top of the space is not moving. The same rule the rows
   *  themselves follow; see `takes` in Tree.svelte. */
  function overRoot(event: DragEvent) {
    const root = workspace.activeSpace?.root
    if (!isTreeDrag(event.dataTransfer) || !root) return

    const paths = carried()
    if (paths.length && !movesInto(paths, root)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTarget.over(root)
  }

  function dropOnRoot(event: DragEvent) {
    event.preventDefault()
    dropTarget.clear()

    const paths = dragged(event.dataTransfer)
    const root = workspace.activeSpace?.root
    if (paths.length && root) void workspace.moveMany(paths, root)
  }

  /** A tack, seen from the side: the head, the shaft, the plate and the needle.
   *  Here rather than in panel-marks.ts because one surface draws it; see the
   *  note at the top of that file. */
  const HOLD_MARK = 'M4.6 2h4M6.6 2v3.2M4 5.2h5.2M6.6 5.2v5.6'

  const PANELS: { id: Panel; label: string; path: string }[] = [
    { id: 'tree', label: t('Files'), path: FILES_MARK },
    { id: 'outline', label: t('Outline'), path: OUTLINE_MARK },
    { id: 'search', label: t('Search'), path: SEARCH_MARK },
    { id: 'links', label: t('Links'), path: LINKS_MARK },
  ]

  /** Whether the Links panel is showing the picture. Held here because the switch
   *  for it is in the row of panel tabs above.
   *
   *  How far out it reaches is the space's, not this window's: it is a fact about
   *  how the space is read, and the picture in the tab and the one in the panel are
   *  two views of the same setting. See workspace/graph-settings.svelte.ts. */
  let graphing = $state(false)
  const depth = $derived(workspace.graphSettings.here.depth)

  /** What the file list draws: the listing off the disk with the rows an account's
   *  first pass has named grafted into it. See `shownTree` in workspace.svelte.ts. */
  const listing = $derived(workspace.shownTree)

  /** Right-clicking the Files tab is where a file list keeps its sorting. */
  function sortMenu(): MenuEntry[] {
    const options = workspace.treeOptions
    const arrow = (key: SortKey) =>
      options.sort === key ? (options.descending ? '↓' : '↑') : undefined

    return [
      { label: t('Sort by name'), hint: arrow('name'), run: () => workspace.setSort('name') },
      {
        label: t('Sort by modified'),
        hint: arrow('modified'),
        run: () => workspace.setSort('modified'),
      },
      {
        label: t('Sort by created'),
        hint: arrow('created'),
        run: () => workspace.setSort('created'),
      },
      DIVIDER,
      {
        label: options.showHidden ? t('Hide hidden files') : t('Show hidden files'),
        run: () => workspace.toggleHidden(),
      },
      DIVIDER,
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('New canvas'), run: () => void workspace.createCanvas() },
      { label: t('New folder'), run: () => void workspace.createFolder() },
    ]
  }

  /** The order the results are read in. The same menu the file list's sort is,
   *  in the same place - a press on the tab - because it is the same question
   *  about the same space asked of a different list. */
  function resultsMenu(): MenuEntry[] {
    const arrow = (key: SearchSort) =>
      search.ordering.sort === key ? (search.ordering.descending ? '↓' : '↑') : undefined

    return [
      {
        label: t('Sort by relevance'),
        hint: arrow('relevance'),
        run: () => search.setSort('relevance'),
      },
      { label: t('Sort by name'), hint: arrow('name'), run: () => search.setSort('name') },
      {
        label: t('Sort by modified'),
        hint: arrow('modified'),
        run: () => search.setSort('modified'),
      },
      {
        label: t('Sort by created'),
        hint: arrow('created'),
        run: () => search.setSort('created'),
      },
    ]
  }

  /** What a press on a panel's own tab offers, for the two panels that have
   *  something to say about the order of what they show. */
  function tabMenu(id: Panel): MenuEntry[] | null {
    if (id === 'tree') return sortMenu()
    return id === 'search' ? resultsMenu() : null
  }

  /** What the space itself offers, wherever in the panel you ask for it. */
  function spaceMenu(): MenuEntry[] {
    return [
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('New canvas'), run: () => void workspace.createCanvas() },
      { label: t('New folder'), run: () => void workspace.createFolder() },
    ]
  }

  /** What a phone's menu sheet is headed with. Left out entirely when there is
   *  no space to name, since `title: undefined` is not the same as no title. */
  function titleOfSpace(): { title?: string } {
    const name = workspace.activeSpace?.name
    return name === undefined ? {} : { title: name }
  }

  /** A bookmarked search puts its words back in the box and runs them. The
   *  panel is named rather than shown, because `showPanel` is a switch and
   *  would shut a search panel that was already open. */
  function runBookmarked(text: string) {
    if (workspace.panel !== 'search') workspace.showPanel('search')
    search.ask(text)
  }

  $effect(() => {
    if (workspace.panel === 'search') void workspace.loadTags()
  })

  /** Whether the panels are held on a tab rather than following the pane. */
  const held = $derived(!!workspace.heldTabId && workspace.panelTab?.id === workspace.heldTabId)
  /** Which panels can be held: the two that are about one note. The files are
   *  the space's and a search is the space's, so neither has a note to be held
   *  on.
   *
   *  Not on a handheld, which holds one document at a time: there is nothing to
   *  hold a panel against, and opening another note closes the tab the panel
   *  would have been held on. */
  const holdable = $derived(
    !viewport.touch && (workspace.panel === 'outline' || workspace.panel === 'links'),
  )

  /** Takes the reader to a line of the note the panel is about.
   *
   *  A panel held on a note open in another pane takes them to that pane first: a
   *  row is pressed to go somewhere, and going somewhere means being there. */
  function jump(line: number) {
    const tab = workspace.panelTab
    if (tab && tab.id !== workspace.activeTabId) workspace.activate(tab.id)
    ongoto?.(line)
  }

  /** The outline steps in and fades from the shallowest heading the note
   *  has, so a note that starts at "##" is not drawn as one missing its
   *  title. */
  const shallowest = $derived(
    workspace.headings.reduce((least, heading) => Math.min(least, heading.level), 6),
  )

  /** The heading the caret is under: the last one that starts on or above
   *  the caret's line. The editor keeps the caret up to date as it moves, and
   *  on a phone it is also the only thing that says where in the note you
   *  were, since the drawer covers the note. */
  const current = $derived.by(() => {
    if (workspace.panel !== 'outline') return -1

    const tab = workspace.panelTab
    const headings = workspace.headings
    if (!tab || !headings.length) return -1

    // The editor says which line the caret is on; only a session written by an
    // older build has to have it worked out from the newlines before it.
    const line = tab.line ?? lineOf(tab.doc, tab.cursor ?? 0)
    return headingAt(headings, line)
  })

  let outline = $state<HTMLElement>()

  /** The row a drop would land on, which side of it the line sits, and which row
   *  is being dragged. The same three the bookmarks keep, and for the same
   *  reason: a drag under way will not say what it carries, only what kind of
   *  thing it is, so the row it came from has to be remembered here. */
  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)
  let dragging = $state<number | null>(null)

  function startSection(event: DragEvent, at: number) {
    carrySection(event.dataTransfer, at)
    dragging = at
  }

  function endSection() {
    dropAt = null
    dragging = null
  }

  function overSection(event: DragEvent, at: number) {
    // Only where the drop would move something: a section held over itself, or
    // over a heading inside it, lights nothing because it would do nothing.
    if (!isSectionDrag(event.dataTransfer)) return
    if (dragging !== null && !movesSection(workspace.headings, dragging, at)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    dropAt = at
    // The line marks the edge the section arrives at: the top of the row when it
    // is coming down the list, the bottom when it is going up.
    dropAbove = dragging !== null && dragging > at
  }

  function dropSection(event: DragEvent, at: number) {
    event.preventDefault()

    const from = draggedSection(event.dataTransfer)
    endSection()
    if (from !== null) onmovesection?.(from, at)
  }

  /** What a heading's own menu offers: bookmarking it, and on a touch screen the
   *  move a drag would have made. */
  function headingMenu(at: number, text: string): MenuEntry[] {
    return [
      ...bookmarkEntry(workspace.bookmarks.forHeading(workspace.panelNote, text)),
      ...moveSectionEntries(at),
    ]
  }

  /** Moving a section where a drag is not available. A held finger opens the
   *  menu before a drag could start and a browser fires no drag events from a
   *  touch at all, so the menu offers the move, in the sheet every other question
   *  uses. The same call the drop makes, so it is the same move and the same
   *  undo. See Tree.svelte, which answers the same problem the same way. */
  function moveSectionEntries(at: number): MenuEntry[] {
    if (!viewport.touch) return []

    const targets = workspace.headings
      .map((heading, index) => ({ id: String(index), label: heading.text, index }))
      .filter((one) => movesSection(workspace.headings, at, one.index))
    if (!targets.length) return []

    return [
      {
        label: t('Move'),
        run: () => {
          void (async () => {
            const { prompt } = await import('./prompt.svelte')
            const to = await prompt.find({
              title: t('Move after'),
              options: targets.map((one) => ({ id: one.id, label: one.label })),
              placeholder: t('Heading'),
            })
            if (to !== null) onmovesection?.(at, Number(to))
          })()
        },
      },
    ]
  }

  // The caret's heading is in view the moment the panel opens and stays there
  // as the caret moves. Nearest, so a row already showing does not pull the
  // list around under the finger.
  $effect(() => {
    const list = outline
    if (!list || current < 0) return
    // `is-on` is what the row wears; it was `.active` before the row moved into
    // the themes package, and a selector nothing matched meant the outline
    // quietly stopped following the caret.
    list.querySelector('.row.is-on')?.scrollIntoView({ block: 'nearest' })
  })

  /** Which way the panel's contents come in when the space changes: from
   *  below when the new space sits lower in the switcher, from above when it
   *  sits higher, so the motion agrees with the row that was pressed.
   *
   *  Kept by an effect rather than worked out in a derived. A derived is read on
   *  demand and may be read twice or not at all, so a "previous value" written
   *  down inside one is not the previous value: the direction came out wrong
   *  whenever the panel happened to read it an extra time. Before the paint, so
   *  the transition that is about to start is the one this decided. */
  const place = $derived(workspace.spaces.findIndex((one) => one.id === workspace.activeSpaceId))
  let direction = $state(1)
  let lastPlace = -1

  $effect.pre(() => {
    direction = place >= lastPlace ? 1 : -1
    lastPlace = place
  })

  const size = new SidebarWidth()
  let aside = $state<HTMLElement>()

  // The edge can go while a finger is still on it - Escape, the back gesture, a
  // note chosen on a phone - and then no pointerup ever reaches it.
  $effect(() => () => size.release())
</script>

<!-- On a desktop the sidebar slides open and shut, and the document slides
     with it, because the width is what animates rather than the opacity. On
     a phone the drawer it sits in is what moves, and this must be its full
     width the moment it exists, or the drag that opened it measures a
     sidebar still growing. -->
<aside
  bind:this={aside}
  class:resizing={size.dragging}
  style:width={size.pixels !== null && !viewport.touch ? `${size.pixels}px` : undefined}
  transition:slide={{ axis: 'x', duration: dur(viewport.touch ? 0 : 210), easing: cubicOut }}
>
  <!-- The strip along the right edge that changes the width. Not on a phone,
       where the drawer is as wide as the drawer is. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="edge"
    title={t('Drag to resize')}
    onpointerdown={(event) => size.start(event, aside)}
    ondblclick={() => size.reset()}
  ></div>

  <!-- Which space this is. A panel with no subject is a list of names belonging
       to nobody, so the name comes first and is itself the switcher: every other
       space is a row in it, with its own mark, and there is no second column of
       wordless squares saying the same thing. See SpaceSwitcher.svelte. -->
  <!-- The regions of the window carry one attribute each, so the order F6 walks is
       the order the sidebar is built in and cannot drift from it; see focus.ts. -->
  <div class="head" data-region="space">
    <!-- Where the panel is a drawer over the note it covers the bar the sidebar
         button sits in, so the drawer carries the same button at the same corner
         of the screen - one component, one glyph, one movement; see
         SidebarToggle.svelte. A docked panel leaves the bar's own button where
         it is and has none of its own. -->
    {#if viewport.drawer}
      <SidebarToggle />
    {/if}

    <SpaceSwitcher />

    <!-- The stretch the switcher does not take. Nothing in it, so it is what the
         plus is pushed to the far end by. -->
    <span class="gap"></span>

    <!-- The one plus. A desktop's lives at the end of the tab strip, where a
         browser puts it; a handheld has no tab strip, so it is here. Either way
         a plain press makes a note and a held finger offers the other two kinds,
         which is what the strip's plus does; see Tabs.svelte. -->
    {#if viewport.touch}
      <button
        class="new"
        title={t('New note')}
        aria-label={t('New note')}
        onclick={() => void workspace.createNote()}
        oncontextmenu={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
        use:longPress={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
      >
        <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
      </button>
    {/if}
  </div>

  <div class="switch">
    <!-- Four tabs are one tab stop, and left and right move between them. They
         change as they are arrived at, because what each of them shows is already
         worked out and arrives without a wait - which is the rule the ARIA practices
         give for choosing on arrival. See roving.ts. -->
    <div
      class="nib-segmented"
      data-region="panels"
      use:roving={{
        across: true,
        rows: '[role=tab]',
        current: '[aria-selected=true]',
        wrap: true,
        follow: (tab) => tab.click(),
      }}
      role="tablist"
      aria-label={t('Panels')}
      use:segmented
    >
      {#each PANELS as item (item.id)}
        <button
          class:on={workspace.panel === item.id}
          role="tab"
          title={item.label}
          aria-label={item.label}
          aria-selected={workspace.panel === item.id}
          onclick={() => workspace.showPanel(item.id)}
          oncontextmenu={(event) => {
            const entries = tabMenu(item.id)
            if (entries) menu.show(event, entries, { title: item.label })
          }}
        >
          <svg viewBox="0 0 13 13"><path d={item.path} /></svg>
        </button>
      {/each}
    </div>

    <!-- What a panel has to offer goes at the other end of the row its tabs are
         in: whether a panel about one note stays on it, and whether the Links
         panel says what it has to say as a list or as a picture. -->
    {#if holdable}
      <div class="tools">
        <!-- A panel about one note usually means the note being worked in. Held,
             it means the note it was held on, so an outline can be read on the
             left while another note is written on the right. It lasts for the
             sitting: a panel held on a note nobody remembers holding it on is
             worse than one that simply follows. -->
        <button
          class="tool"
          class:active={held}
          title={held ? t('Follow the open note') : t('Stay on this note')}
          aria-label={held ? t('Follow the open note') : t('Stay on this note')}
          aria-pressed={held}
          onclick={() => workspace.holdPanel(held ? null : (workspace.panelTab?.id ?? null))}
        >
          <svg viewBox="0 0 13 13"><path d={HOLD_MARK} /></svg>
        </button>
      </div>
    {/if}
    {#if workspace.panel === 'links'}
      <div class="tools">
        {#if graphing}
          <!-- One link out, two, or three. Not four: at four most spaces answer
               with the space, and the picture of the whole space is a tab away. -->
          <button
            class="depth"
            title={t('Depth')}
            aria-label={t('Depth')}
            onclick={() =>
              workspace.graphSettings.set({ depth: depth === DEEPEST ? 1 : depth + 1 })}
            transition:fly={{ x: 10, duration: dur(130), easing: cubicOut }}
          >
            {depth}
          </button>
        {/if}
        <button
          class="tool"
          class:active={graphing}
          title={t('Graph')}
          aria-label={t('Graph')}
          aria-pressed={graphing}
          onclick={() => (graphing = !graphing)}
        >
          <svg viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
        </button>
      </div>
    {/if}
  </div>

  <!-- The one thing you can do from anywhere in the app. Outside the Search
       panel it is the door to it; inside, the panel's own field stands in the
       same place, at the same height and in the same box - one control that
       becomes editable rather than two that look alike. -->
  {#if workspace.panel !== 'search'}
    <div class="hunt" data-region="search">
      <button class="nib-field" onclick={() => workspace.showPanel('search')}>
        <svg class="nib-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
        <span class="nib-row-label">{t('Search this space')}</span>
      </button>
    </div>
  {/if}

  <!-- Rebuilt for each space, arriving from the side of the switcher the new
       space is on; and inside that, one panel crossing with the next. The two
       are stacked rather than in a column, so the one going and the one coming
       occupy the same place and the list under them does not jump; only their
       transforms and their opacities change, which is the compositor's work
       alone. -->
  {#key workspace.activeSpaceId}
    <div class="stack" in:fly={{ y: 16 * direction, duration: dur(220), easing: cubicOut }}>
      {#key workspace.panel}
        <!-- Which panel this is holding, because the body crossfades: for a moment
             there are two of it on screen and only one of them is the one that is
             arriving. See boxOf in focus.ts. -->
        <div
          class="body"
          data-region="list"
          data-panel={workspace.panel}
          use:scrollbar={workspace.panel}
          in:arrive
          out:leave
        >
          <!-- Which note the panel is held on. Only while it is held, and only
               where holding means anything: the panel is already full of that
               note, so this is the one line that says whose. -->
          {#if held && holdable}
            <p class="holding">{workspace.panelTab?.shown ?? ''}</p>
          {/if}

          {#if workspace.panel === 'tree'}
            {#if listing}
              <Bookmarks onsearch={runBookmarked} />

              <!-- A word in capitals over each group, the way every list worth
               reading is cut up; see docs/design.md. -->
              <p class="nib-section">{t('Files')}</p>

              <!-- The listing plus a row for every note an account's first pass has
                   named and not fetched yet, which is what makes a fresh sign-in a
                   file list rather than a wait; see `shownTree` in
                   workspace.svelte.ts. -->
              <Tree entries={listing.children} />

              <!-- A space with nothing in it says what to do about it. Folders can
             still be there, which is why this counts files and not rows. Nor is a
             space with notes on their way an empty one. -->
              {#if !workspace.files.length && !arriving.coming.size}
                <button class="empty" onclick={() => workspace.createNote()}>{t('New note')}</button
                >
              {/if}

              <!-- The space below the last row still belongs to the space, so it
             takes the same menu instead of swallowing the click, and accepts a
             note dropped on it as "out of whatever folder it was in". -->
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
              <div
                class="rest"
                class:dropping={rootDrop}
                oncontextmenu={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
                onclick={() => workspace.cancelNaming()}
                ondragover={overRoot}
                ondragleave={() => dropTarget.clear()}
                ondrop={dropOnRoot}
              ></div>
            {:else}
              <button class="empty" onclick={() => newSpace()}>{t('Create a space')}</button>
            {/if}
          {:else if workspace.panel === 'outline'}
            {#if workspace.headings.length}
              <!-- The same walk and the same one tab stop every list in the app
                   has; see roving.ts. Enter goes to the heading and hands the
                   keyboard to the note, Space goes to it and stays here, so a note
                   can be read down heading by heading without leaving the outline. -->
              <ul
                bind:this={outline}
                use:roving={{
                  current: '.is-on',
                  open: (row) => jump(Number(row.dataset.line ?? 0)),
                  peek: (row) => {
                    // Going to a heading hands the note the keyboard, so Space takes
                    // it straight back: the point of Space is to stay here.
                    jump(Number(row.dataset.line ?? 0))
                    row.focus()
                  },
                  menu: (row, at) => row.dispatchEvent(at),
                }}
              >
                {#each workspace.headings as heading, index (index)}
                  <li>
                    <button
                      class="nib-row is-short row heading"
                      class:is-on={index === current}
                      class:above={dropAt === index && dropAbove}
                      class:below={dropAt === index && !dropAbove}
                      data-line={heading.line}
                      style:--level={heading.level - shallowest}
                      draggable="true"
                      onclick={() => jump(heading.line)}
                      oncontextmenu={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      use:longPress={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      ondragstart={(event) => startSection(event, index)}
                      ondragover={(event) => overSection(event, index)}
                      ondragleave={() => (dropAt = null)}
                      ondragend={endSection}
                      ondrop={(event) => dropSection(event, index)}
                    >
                      <span class="nib-row-label">{heading.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty-text">{t('No headings in this note')}</p>
            {/if}

            <!-- Under the headings, because they are the same kind of thing: the
                 shape of the note being read, and a row that jumps within it. Only
                 when the note has any; a heading over nothing is a wall. -->
            {#if workspace.footnotes.length}
              <p class="nib-section">{t('Footnotes')}<span>{workspace.footnotes.length}</span></p>
              <ul>
                {#each workspace.footnotes as note (note.id)}
                  <li>
                    <button
                      class="nib-row is-short row note"
                      class:is-quiet={!note.used}
                      onclick={() => jump(note.line)}
                    >
                      <span class="nib-row-mark note-id">{note.id}</span>
                      <span class="nib-row-label">{note.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if workspace.panel === 'links'}
            <Links {ongoto} graph={graphing} {depth} onlist={() => (graphing = false)} />
          {:else if workspace.panel === 'search'}
            <SearchPanel {ongoto} />
          {/if}
        </div>
      {/key}
    </div>
  {/key}

  <!-- Who is at this device, the theme and the settings, in a quiet row at the
       bottom of the panel: the three things the column of spaces used to carry
       under it, which belong to the app rather than to any one note. The same
       row on a desktop and in a drawer; see SidebarFoot.svelte. -->
  <SidebarFoot />
</aside>

<style>
  aside {
    position: relative;
    width: var(--sidebar-width);
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--line);
    background: var(--side-bar-bg-color);
  }

  /* Wider than the line it sits on, so it can be caught, and drawn only while
     it is being used: a handle that is always visible is a stripe. */
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -4px;
    width: 8px;
    z-index: 2;
    cursor: col-resize;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  aside.resizing .edge::after {
    background: var(--accent);
  }

  /* The three rows of chrome above the list, in the order identity, action,
     view. Each is `--space-1` in from the panel's edge and everything inside
     them is `--row-pad` in from that, so the words in the header, the words in
     the search pill and the marks in the rows below all start on one line down
     the panel; see docs/design.md. */
  /* Positioned, because the list of spaces drops out of it: the head spans the
     panel, so a list hung from it lines up with the search pill and the rows
     under it without anything being measured. See SpaceSwitcher.svelte. */
  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
  }

  .gap {
    flex: 1;
    min-width: 0;
  }

  .new {
    flex: none;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .new:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .new:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .hunt {
    flex: none;
    padding: 0 var(--space-1) var(--space-2);
  }

  /* The pill's words are the placeholder they stand in for; the magnifier is
     what says what it is. */
  .hunt .nib-row-label {
    color: var(--muted);
  }

  .switch {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-1) var(--space-2);
  }

  /* The tabs are the segmented control the settings sheet already uses: one
     shape, so "this one" looks the same wherever the app says it. */
  .switch .nib-segmented {
    flex: 1;
    min-width: 0;
  }

  /* At the far end of the row, so the tabs keep their place whether or not the
     panel showing has anything to offer. */
  /* The note a held panel is about, over the panel that is about it. Quiet: the
     panel says the same thing in more detail, and this is only here to say whose
     note that is. */
  .holding {
    margin: 0;
    padding: 0 var(--row-pad) var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  .tools button {
    width: var(--row-height);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .tools button:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
  }

  .tools button:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .tools button.active {
    background: var(--surface-selected);
    color: var(--accent);
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  /* What is left of the panel once the head, the tabs and the search entry have
     had theirs - and the ground the panels cross over. Positioned, so the one
     going and the one coming can be in the same place for the moment they are
     both here; a column would put them one above the other and shove the list
     around. */
  .stack {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* A column so the filler below the tree can take the leftover height. */
  .body {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    /* A list that runs out of rows stops there, rather than handing the
       scroll on to whatever is behind the drawer. */
    overscroll-behavior: contain;
    padding: 0 var(--space-1) var(--space-4);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The row is `.nib-row`, drawn once in the themes package. Each level of the
     outline steps in and fades a little, and that is the whole hierarchy; both
     hang off `--level`, so a phone takes a deeper step without a second set of
     numbers in the markup. The tree is indented the same way. */
  .heading {
    position: relative;
    padding-left: calc(var(--row-pad) + var(--level) * var(--row-indent));
    opacity: calc(1 - var(--level) * 0.09);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  /* A footnote's own label, in the mark's box so every one of them starts where
     a heading's words do. Raised and in the accent, which is how the note itself
     draws the mark this row stands for. */
  .note-id {
    align-self: start;
    margin-top: 0.3em;
    color: var(--accent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  /* Where a section being dragged would land: along the edge it arrives at,
     rather than a box around the row it is passing. The same line the bookmarks
     draw for a row on its way somewhere. */
  .heading.above::before,
  .heading.below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .heading.above::before {
    top: -1px;
  }

  .heading.below::after {
    bottom: -1px;
  }

  .heading.is-on {
    opacity: 1;
  }

  /* Only where there is a pointer to hover with: on a touch screen the nudge
     would stick to whatever was tapped last. */
  @media (hover: hover) {
    .heading:hover {
      transform: translateX(2px);
    }
  }

  /* Fills whatever is left, so the whole panel responds. */
  .rest {
    flex: 1;
    min-height: var(--space-6);
  }

  .empty-text {
    margin: var(--space-3) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  /* Says the drop will land, without pretending to be a row. */
  .rest.dropping {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
  }

  .empty {
    width: 100%;
    min-height: var(--row-height);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      border-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .empty:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty:active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* One weight for every drawing in the panel; how big each is comes from what
     it is: a tab and a button wear `--icon-lg`, a mark beside words wears
     `--icon-md`, and the chevron after a name is the smallest of the three. */
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .switch svg,
  .new svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }

  /* A drawer is as wide as it needs to be to read a list of names in, and it
     is never dragged wider: there is no pointer to grab the edge with. */
  :global([data-drawer]) aside {
    width: min(78vw, 20rem);
  }

  :global([data-touch]) .edge {
    display: none;
  }

  /* Past this width the drawer is the whole screen rather than a panel over the
     note, and the panel is the whole of the drawer. Only where the sidebar is a
     drawer at all: `data-narrow` is the width alone, and a desktop window
     dragged this narrow keeps its columns. */
  :global([data-drawer][data-narrow]) aside {
    flex: 1;
    width: auto;
    min-width: 0;
    /* The whole screen, so it is a page of its own rather than a panel beside
       the note, and takes the note's ground rather than the lighter surface a
       panel has next to it. */
    background: var(--bg);
  }

  /* Docked beside the note on a tablet held sideways. It arrives rather than
     appears, and on the compositor: the column itself is not animated, because
     animating a width relays out the editor beside it on every frame.

     As wide as the drawer, rather than a pointer's 252px: every part of a panel
     read with a thumb is bigger, so the column holding them has to be. At the
     narrower width the foot's own name ran out of room before it was finished. */
  :global([data-touch]:not([data-drawer])) aside {
    width: 20rem;
    animation: dock var(--dur-base) var(--ease-out);
  }

  @keyframes dock {
    from {
      opacity: 0;
      transform: translateX(-12px);
    }
  }

  /* Clear of the status bar, the way the titlebar is on the other side. That is
     the whole of what a finger changes here: the header, the pill, the tabs and
     every row read the row scale, and the row scale is restated from the touch
     scale once, in tokens.css. */
  :global([data-touch]) .head {
    padding-top: var(--inset-top);
  }

  /* Room under the last row. What clears the gesture bar is the foot below
     this, which is the thing actually at the bottom of the screen. */
  :global([data-touch]) .body {
    padding-bottom: var(--space-4);
  }

  :global([data-touch]) .empty-text,
  :global([data-touch]) .empty {
    font-size: var(--touch-text);
  }
</style>
