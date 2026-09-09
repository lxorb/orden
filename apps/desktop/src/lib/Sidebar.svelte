<script lang="ts">
  import { carried, dragged, isTreeDrag } from './drag-paths'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { movesInto } from './move-targets'
  import { newSpace } from './space-actions'
  import { headingAt, lineOf } from './outline'
  import { bookmarkEntry, DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import type { Panel, SortKey } from './workspace.svelte'
  import { scrollbar } from './scrollbar'
  import { workspace } from './workspace.svelte'
  import { search } from './search.svelte'
  import { SidebarWidth } from './sidebar-width.svelte'
  import { viewport } from './viewport.svelte'
  import Bookmarks from './Bookmarks.svelte'
  import Links from './Links.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import { dropTarget } from './drop-target.svelte'
  import Tree from './Tree.svelte'
  import { dur } from './motion'

  const { ongoto }: { ongoto?: (line: number) => void } = $props()

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

  const PANELS: { id: Panel; label: string; path: string }[] = [
    // A folder with its corners taken off and its tab eased into the body, so it
    // sits with the arcs of the three tabs beside it rather than as the one hard
    // shape in the row. Same bounds as the square one it replaces.
    {
      id: 'tree',
      label: t('Files'),
      path: 'M2.2 3.5h2.3c.5 0 .7.4 1 .9s.5.6 1 .6h4.3a1.2 1.2 0 0 1 1.2 1.2v4.1a1.2 1.2 0 0 1-1.2 1.2H2.2A1.2 1.2 0 0 1 1 10.3V4.7a1.2 1.2 0 0 1 1.2-1.2z',
    },
    { id: 'outline', label: t('Outline'), path: 'M2 2.5h9M4 6.5h7M6 10.5h5' },
    { id: 'search', label: t('Search'), path: 'M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3' },
    // Two links of a chain, which is what a link between notes is.
    {
      id: 'links',
      label: t('Links'),
      path: 'M5.6 7.4 7.4 5.6M6.9 4.3l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.4 9.9l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2',
    },
  ]

  const GRAPH_ICON =
    'M1.4 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M8 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M4.7 9.9a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M5 3.4h3M5.7 8.3 4 5M7.3 8.3 9 5'

  /** Whether the Links panel is showing the picture, and how far out it reaches.
   *  Held here because the switch for it is in the row of panel tabs above. */
  let graphing = $state(false)
  let depth = $state(1)

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

  /** What the space itself offers, wherever in the panel you ask for it. */
  function spaceMenu(): MenuEntry[] {
    return [
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('New canvas'), run: () => void workspace.createCanvas() },
      { label: t('New folder'), run: () => void workspace.createFolder() },
      DIVIDER,
      // Nothing to reveal when no space is open, and `revealEntry` says so.
      ...revealEntry(workspace.activeSpace?.root),
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

    const tab = workspace.active
    const headings = workspace.headings
    if (!tab || !headings.length) return -1

    // The editor says which line the caret is on; only a session written by an
    // older build has to have it worked out from the newlines before it.
    const line = tab.line ?? lineOf(tab.doc, tab.cursor ?? 0)
    return headingAt(headings, line)
  })

  let outline = $state<HTMLElement>()

  // The caret's heading is in view the moment the panel opens and stays there
  // as the caret moves. Nearest, so a row already showing does not pull the
  // list around under the finger.
  $effect(() => {
    const list = outline
    if (!list || current < 0) return
    list.querySelector('.row.active')?.scrollIntoView({ block: 'nearest' })
  })

  /** Which way the panel's contents come in when the space changes: from
   *  below when the new space sits lower in the rail, from above when it sits
   *  higher, so the motion agrees with the finger or the eye that chose it.
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

  <div class="switch">
    {#each PANELS as item (item.id)}
      <button
        class:active={workspace.panel === item.id}
        title={item.label}
        aria-label={item.label}
        aria-current={workspace.panel === item.id}
        onclick={() => workspace.showPanel(item.id)}
        oncontextmenu={(event) =>
          item.id === 'tree' && menu.show(event, sortMenu(), { title: item.label })}
      >
        <svg viewBox="0 0 13 13"><path d={item.path} /></svg>
      </button>
    {/each}

    <!-- The one choice a panel has goes at the other end of the row its tabs are
         in: the Links panel says the same thing as a list or as a picture. -->
    {#if workspace.panel === 'links'}
      <div class="tools">
        {#if graphing}
          <!-- One link out, or two. Nothing else is worth a control. -->
          <button
            class="depth"
            title={t('Depth')}
            aria-label={t('Depth')}
            onclick={() => (depth = depth === 1 ? 2 : 1)}
            transition:fly={{ x: 10, duration: dur(130), easing: cubicOut }}
          >
            {depth}
          </button>
        {/if}
        <button
          class:active={graphing}
          title={t('Graph')}
          aria-label={t('Graph')}
          aria-pressed={graphing}
          onclick={() => (graphing = !graphing)}
        >
          <svg viewBox="0 0 13 13"><path d={GRAPH_ICON} /></svg>
        </button>
      </div>
    {/if}
  </div>

  <!-- Rebuilt for each space, and arriving from the side of the rail the new
       space is on. -->
  {#key workspace.activeSpaceId}
    <div
      class="body"
      use:scrollbar={workspace.panel}
      in:fly={{ y: 16 * direction, duration: dur(220), easing: cubicOut }}
    >
      {#if workspace.panel === 'tree'}
        {#if workspace.tree}
          <Bookmarks onsearch={runBookmarked} />

          <Tree entries={workspace.tree.children} />

          <!-- A space with nothing in it says what to do about it. Folders can
             still be there, which is why this counts files and not rows. -->
          {#if !workspace.files.length}
            <button class="empty" onclick={() => workspace.createNote()}>{t('New note')}</button>
          {/if}

          <!-- The space below the last row still belongs to the space, so it
             takes the same menu instead of swallowing the click, and accepts a
             note dropped on it as "out of whatever folder it was in". -->
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <div
            class="rest"
            class:dropping={rootDrop}
            oncontextmenu={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
            onclick={() => workspace.stopRenaming()}
            ondragover={overRoot}
            ondragleave={() => dropTarget.clear()}
            ondrop={dropOnRoot}
          ></div>
        {:else}
          <button class="empty" onclick={() => newSpace()}>{t('Create a space')}</button>
        {/if}
      {:else if workspace.panel === 'outline'}
        {#if workspace.headings.length}
          <ul bind:this={outline}>
            {#each workspace.headings as heading, index (index)}
              <li>
                <button
                  class="row heading"
                  class:active={index === current}
                  style:--level={heading.level - shallowest}
                  onclick={() => ongoto?.(heading.line)}
                  oncontextmenu={(event) =>
                    menu.show(
                      event,
                      bookmarkEntry(
                        workspace.bookmarks.forHeading(workspace.relativeNote, heading.text),
                      ),
                      { title: heading.text },
                    )}
                >
                  <span class="label">{heading.text}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-text">{t('No headings in this note')}</p>
        {/if}
      {:else if workspace.panel === 'links'}
        <Links {ongoto} graph={graphing} {depth} onlist={() => (graphing = false)} />
      {:else if workspace.panel === 'search'}
        <SearchPanel {ongoto} />
      {/if}
    </div>
  {/key}
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

  .switch {
    display: flex;
    gap: 2px;
    padding: var(--space-2) var(--space-2) var(--space-1);
  }

  /* At the far end of the row, so the tabs keep their place whether or not the
     panel showing has anything to offer. */
  .tools {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }

  /* A digit, where the others have a mark. */
  .depth {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .switch button {
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .switch button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .switch button:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .switch button.active {
    background: var(--surface-3);
    color: var(--accent);
  }

  .switch button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  /* Larger than the rest of the sidebar's glyphs: these are the tabs, and a
     13px mark in a 26px button read as padding around not much. */
  .switch button svg {
    width: 16px;
    height: 16px;
  }

  /* A column so the filler below the tree can take the leftover height. */
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    /* A list that runs out of rows stops there, rather than handing the
       scroll on to whatever is behind the drawer. */
    overscroll-behavior: contain;
    padding: var(--space-1) var(--space-2) var(--space-4);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  /* The words are what get cut short, not the row: a flex row leaves the
     ellipsis to its child, which is also what lets the row centre a single
     line in whatever height a thumb needs. */
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Each level steps in and fades a little, and that is the whole hierarchy.
     Both hang off `--level` rather than being written inline, so a phone can
     take a bigger step without a second set of numbers in the markup. */
  .heading {
    --indent: 11px;
    padding-left: calc(8px + var(--level) * var(--indent));
    opacity: calc(1 - var(--level) * 0.09);
  }

  .heading.active {
    opacity: 1;
  }

  .row:hover {
    background: var(--item-hover-bg-color);
    color: var(--item-hover-text-color);
  }

  .row:active {
    background: var(--press);
    color: var(--text-strong);
  }

  /* Only where there is a pointer to hover with: on a touch screen the nudge
     would stick to whatever was tapped last. */
  @media (hover: hover) {
    .row.heading:hover {
      transform: translateX(2px);
    }
  }

  .row.active {
    color: var(--active-file-text-color);
    font-weight: 550;
  }

  /* The heading the caret is under is a place, not a pick, so it may be
     shown the way a pick is. A bookmarked note that is open is not. */
  .row.heading.active {
    background: var(--active-file-bg-color);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* Fills whatever is left, so the whole panel responds. */
  .rest {
    flex: 1;
    min-height: var(--space-6);
  }

  .empty-text {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  /* Says the drop will land, without pretending to be a row. */
  .rest.dropping {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }

  .empty {
    width: 100%;
    padding: var(--space-3);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
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

  svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A drawer is as wide as it needs to be to read a list of names in, and it
     is never dragged wider: there is no pointer to grab the edge with. */
  :global([data-drawer]) aside {
    width: min(78vw, 20rem);
  }

  :global([data-touch]) .edge {
    display: none;
  }

  /* On a narrow drawer the rail plus a 20rem sidebar leaves a sliver of the
     document showing, which reads as a mistake rather than a peek. Only where the
     sidebar is a drawer: `data-narrow` is the width alone, and a desktop window
     dragged this narrow keeps its columns. Past that
     point the drawer takes the whole width, and this fills whatever the rail
     does not - measuring it instead would need the rail's mobile width, which
     is not what `--rail-width` says. */
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
     animating a width relays out the editor beside it on every frame. */
  :global([data-touch]:not([data-drawer])) aside {
    animation: dock var(--dur-base) var(--ease-out);
  }

  @keyframes dock {
    from {
      opacity: 0;
      transform: translateX(-12px);
    }
  }

  /* Clear of the status bar, the way the titlebar is on the other side. */
  :global([data-touch]) .switch {
    padding-top: calc(var(--space-2) + var(--inset-top));
  }

  /* A tab is as tall as a row and as wide as a thumb: five of them have to fit
     across a drawer, so the width is the floor and the height is the scale. */
  :global([data-touch]) .switch button {
    width: var(--touch-target);
    height: var(--touch-row);
  }

  :global([data-touch]) .switch button svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  /* The one tab wearing a number rather than a drawing reads at the size the
     drawings are. */
  :global([data-touch]) .depth {
    font-size: var(--touch-text);
  }

  /* The last row clears the gesture bar. */
  :global([data-touch]) .body {
    padding-bottom: var(--touch-bottom);
  }

  /* The same size as the tree rows beneath them: everything here is something a
     thumb has to land on. The same type as those rows, too, and none of the
     desktop's vertical padding: the row is already tall, and 12.5px words in
     it were mostly the row. */
  :global([data-touch]) .row {
    min-height: var(--touch-row);
    gap: var(--touch-gap);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  /* An outline is read more than it is tapped: a shorter row than the tree's,
     still a whole line for a thumb, and a deeper step per level so the
     hierarchy survives the larger type. */
  :global([data-touch]) .heading {
    --indent: var(--touch-indent);
    min-height: var(--touch-target);
    padding-left: calc(var(--touch-pad) + var(--level) * var(--indent));
  }

  :global([data-touch]) .empty-text,
  :global([data-touch]) .empty {
    font-size: var(--touch-text);
  }

  :global([data-touch]) .empty-text {
    margin: var(--space-3) var(--space-2) 0;
  }

  :global([data-touch]) .empty {
    min-height: var(--touch-row);
  }
</style>
