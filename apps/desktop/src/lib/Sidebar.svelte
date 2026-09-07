<script lang="ts">
  import { dragged, isTreeDrag } from './drag-paths'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { newSpace } from './space-actions'
  import { headingAt, lineOf } from './outline'
  import { bookmarkEntry, DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import type { Hit, Panel, SortKey } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { SidebarWidth } from './sidebar-width.svelte'
  import { viewport } from './viewport.svelte'
  import Bookmarks from './Bookmarks.svelte'
  import Links from './Links.svelte'
  import Tree from './Tree.svelte'

  const { ongoto }: { ongoto?: (line: number) => void } = $props()

  /** Lit while a note is held over the space below the tree. */
  let rootDrop = $state(false)

  function overRoot(event: DragEvent) {
    if (!isTreeDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    rootDrop = true
  }

  function dropOnRoot(event: DragEvent) {
    event.preventDefault()
    rootDrop = false

    const paths = dragged(event.dataTransfer)
    const root = workspace.activeSpace?.root
    if (paths.length && root) void workspace.moveMany(paths, root)
  }

  const PANELS: { id: Panel; label: string; path: string }[] = [
    { id: 'tree', label: t('Files'), path: 'M1 3.5h4l1 1.5h6v6.5H1z' },
    { id: 'outline', label: t('Outline'), path: 'M2 2.5h9M4 6.5h7M6 10.5h5' },
    { id: 'search', label: t('Search'), path: 'M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3' },
    // Two links of a chain, which is what a link between notes is.
    {
      id: 'links',
      label: t('Links'),
      path: 'M5.6 7.4 7.4 5.6M6.9 4.3l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.4 9.9l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2',
    },
  ]

  /** A star: the mark bookmarking wears wherever it is not a word. */
  const STAR_ICON =
    'M6.5 1.6l1.55 3.14 3.47.5-2.51 2.45.59 3.45L6.5 9.5 3.4 11.14l.59-3.45L1.48 5.24l3.47-.5z'

  const GRAPH_ICON =
    'M1.4 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M8 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M4.7 9.9a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M5 3.4h3M5.7 8.3 4 5M7.3 8.3 9 5'

  /** Whether the Links panel is showing the picture, and how far out it reaches.
   *  Held here because the switch for it is in the row of panel tabs above. */
  let graphing = $state(false)
  let depth = $state(1)

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

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
      { label: t('New folder'), run: () => void workspace.createFolder() },
    ]
  }

  /** What the space itself offers, wherever in the panel you ask for it. */
  function spaceMenu(): MenuEntry[] {
    return [
      { label: t('New note'), run: () => void workspace.createNote() },
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

  let query = $state('')
  let hits = $state<Hit[]>([])
  let searching = $state(false)
  let debounce: ReturnType<typeof setTimeout>

  /** Which search is the latest. Typing outruns the disk, and a slow search
   *  landing after a quicker one that came later would show the results for a
   *  word that is no longer in the box. */
  let searches = 0

  function onQuery(value: string) {
    query = value
    clearTimeout(debounce)
    searches++

    if (value.trim().length < 2) {
      hits = []
      searching = false
      return
    }

    searching = true
    debounce = setTimeout(() => void run(value, searches), 220)
  }

  async function run(text: string, search: number) {
    const found = await workspace.search(text)
    if (search !== searches) return

    hits = found
    searching = false
  }

  async function openHit(hit: Hit) {
    await workspace.open(hit.path)
    ongoto?.(hit.line)
  }

  /** The search in the box, as something to keep. Null until there is enough
   *  of it to search for. */
  const searchMark = $derived(
    query.trim().length >= 2 ? workspace.bookmarks.forSearch(query) : null,
  )

  /** A bookmarked search puts its words back in the box and runs them. */
  function runBookmarked(text: string) {
    workspace.showPanel('search')
    onQuery(text)
  }

  /** An empty search offers the space's own tags, which is how you find out
   *  what there is to search for. */
  const tags = $derived.by(() => {
    if (workspace.panel !== 'search' || query.trim()) return []
    return workspace.tags
  })

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
   *  Remembers the last index between readings, which is what makes it a
   *  direction and not a position. */
  let lastIndex = -1
  const direction = $derived.by(() => {
    const index = workspace.spaces.findIndex((one) => one.id === workspace.activeSpaceId)
    const towards = index >= lastIndex ? 1 : -1
    lastIndex = index
    return towards
  })

  const size = new SidebarWidth()
  let aside = $state<HTMLElement>()
</script>

<!-- On a desktop the sidebar slides open and shut, and the document slides
     with it, because the width is what animates rather than the opacity. On
     a phone the drawer it sits in is what moves, and this must be its full
     width the moment it exists, or the drag that opened it measures a
     sidebar still growing. -->
<aside
  bind:this={aside}
  class:resizing={size.dragging}
  style:width={size.pixels !== null && !viewport.phone ? `${size.pixels}px` : undefined}
  transition:slide={{ axis: 'x', duration: viewport.phone ? 0 : 210, easing: cubicOut }}
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
            transition:fly={{ x: 10, duration: 130, easing: cubicOut }}
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
    <div class="body" in:fly={{ y: 16 * direction, duration: 220, easing: cubicOut }}>
      {#if workspace.panel === 'tree'}
        {#if workspace.tree}
          <Bookmarks onsearch={runBookmarked} />

          <Tree entries={workspace.tree.children} />

          <!-- A space with nothing in it says what to do about it. Folders can
             still be there, which is why this counts notes and not rows. -->
          {#if !workspace.notes.length}
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
            ondragleave={() => (rootDrop = false)}
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
        <div class="find">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="query"
            value={query}
            oninput={(event) => onQuery(event.currentTarget.value)}
            placeholder={t('Search this space')}
            spellcheck="false"
            autofocus
          />

          <!-- The one place a bookmark is a mark rather than a word: there is no
               row to right-click, and a star in the box says what it does. -->
          {#if searchMark}
            {@const kept = workspace.bookmarks.has(searchMark)}
            <button
              class="star"
              class:on={kept}
              title={kept ? t('Remove bookmark') : t('Bookmark')}
              aria-label={kept ? t('Remove bookmark') : t('Bookmark')}
              aria-pressed={kept}
              onclick={() => workspace.bookmarks.toggle(searchMark)}
              transition:fly={{ x: 6, duration: 130, easing: cubicOut }}
            >
              <svg viewBox="0 0 13 13"><path d={STAR_ICON} /></svg>
            </button>
          {/if}
        </div>

        {#if hits.length}
          <ul>
            {#each hits as hit, index (`${hit.path}:${hit.line}:${index}`)}
              <li>
                <button class="hit" onclick={() => openHit(hit)}>
                  <span class="hit-note">{stripped(hit.name)}</span>
                  <span class="hit-line">{hit.text}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if tags.length}
          <ul class="tags">
            {#each tags as tag (tag.tag)}
              <li>
                <button class="tag" onclick={() => onQuery(tag.tag)}>
                  {tag.tag}<span class="count">{tag.count}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if query.trim().length >= 2 && !searching}
          <p class="empty-text">{t('Nothing found')}</p>
        {/if}
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

  .row:active,
  .hit:active {
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

  .find {
    position: relative;
    margin-bottom: var(--space-2);
  }

  .query {
    width: 100%;
    /* Room for the star at all times, so switching it on moves no text. */
    padding: 6px 30px 6px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .query:focus {
    border-color: var(--accent);
  }

  /* Inside the field rather than beside it: it is about what is in the field. */
  .star {
    position: absolute;
    top: 50%;
    right: 5px;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .star:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .star:active {
    transform: translateY(-50%) scale(0.88);
  }

  .star.on {
    color: var(--accent);
  }

  /* Filled once it is kept: the shape alone says which way it stands. */
  .star.on svg {
    fill: currentColor;
  }

  .star:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .hit {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .hit:hover {
    background: var(--item-hover-bg-color);
  }

  .hit-note {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--accent);
  }

  .hit-line {
    font-size: var(--text-sm);
    color: var(--muted-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Fills whatever is left, so the whole panel responds. */
  .rest {
    flex: 1;
    min-height: var(--space-6);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: var(--space-2) 0;
  }

  .tag {
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      border-color var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .tag:hover {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .tag:active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .count {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
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

  @media (max-width: 720px) {
    aside {
      width: min(78vw, 20rem);
    }

    .edge {
      display: none;
    }

    /* On a narrow screen the rail plus a 20rem sidebar leaves a sliver of the
       document showing, which reads as a mistake rather than a peek. Past that
       point the drawer takes the whole width, and this fills whatever the rail
       does not - measuring it instead would need the rail's mobile width,
       which is not what `--rail-width` says. */
    @media (max-width: 460px) {
      aside {
        flex: 1;
        width: auto;
        min-width: 0;
        /* The whole screen, so it is a page of its own rather than a panel
           beside the note, and takes the note's ground rather than the
           lighter surface a panel has next to it. */
        background: var(--bg);
      }
    }

    /* Clear of the status bar, the way the titlebar is on the other side. */
    .switch {
      padding-top: calc(var(--space-2) + env(safe-area-inset-top));
    }

    .switch button {
      width: 48px;
      height: 48px;
    }

    .switch button svg {
      width: 22px;
      height: 22px;
    }

    /* The last row clears the gesture bar. */
    .body {
      padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    }

    /* Same floor as the tree rows beneath them: everything in the drawer is
       something a thumb has to land on. */
    .row,
    .hit {
      min-height: 48px;
    }

    .hit {
      padding-top: 10px;
      padding-bottom: 10px;
    }

    /* The same type as the tree rows, and none of the desktop's vertical
       padding: the row is already tall, and 12.5px words in it were mostly
       the row. */
    .row {
      padding-top: 0;
      padding-bottom: 0;
      font-size: var(--text-base);
    }

    /* An outline is read more than it is tapped: a shorter row than the
       tree's, still a whole line for a thumb, and a deeper step per level so
       the hierarchy survives the larger type. */
    .heading {
      --indent: 14px;
      min-height: 40px;
    }

    .empty-text {
      margin: var(--space-3) var(--space-2) 0;
      font-size: var(--text-base);
    }

    /* 16px is where iOS stops zooming into a focused field. */
    .query {
      min-height: 44px;
      padding: 10px 12px;
      font-size: 16px;
    }
  }
</style>
