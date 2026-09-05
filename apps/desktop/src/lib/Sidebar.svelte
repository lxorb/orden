<script lang="ts">
  import { dragged, isTreeDrag } from './drag-paths'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { newSpace } from './space-actions'
  import { headingAt, lineOf } from './outline'
  import { DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import type { Entry, Hit, Panel, SortKey } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { viewport } from './viewport.svelte'
  import Tree from './Tree.svelte'

  let { ongoto }: { ongoto?: (line: number) => void } = $props()

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
  ]

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  /** Right-clicking the Files tab is where a file list keeps its sorting. */
  function sortMenu(): MenuEntry[] {
    const options = workspace.treeOptions
    const arrow = (key: SortKey) =>
      options.sort === key ? (options.descending ? '↓' : '↑') : undefined

    return [
      { label: t('Sort by name'), hint: arrow('name'), run: () => workspace.setSort('name') },
      { label: t('Sort by modified'), hint: arrow('modified'), run: () => workspace.setSort('modified') },
      { label: t('Sort by created'), hint: arrow('created'), run: () => workspace.setSort('created') },
      DIVIDER,
      {
        label: options.showHidden ? t('Hide hidden files') : t('Show hidden files'),
        run: () => workspace.toggleHidden(),
      },
      DIVIDER,
      { label: t('New note'), run: () => workspace.createNote() },
      { label: t('New folder'), run: () => workspace.createFolder() },
    ]
  }

  /** What the space itself offers, wherever in the panel you ask for it. */
  function spaceMenu(): MenuEntry[] {
    return [
      { label: t('New note'), run: () => workspace.createNote() },
      { label: t('New folder'), run: () => workspace.createFolder() },
      DIVIDER,
      ...revealEntry(workspace.activeSpace!.root),
    ]
  }

  let query = $state('')
  let hits = $state<Hit[]>([])
  let searching = $state(false)
  let debounce: ReturnType<typeof setTimeout>

  function onQuery(value: string) {
    query = value
    clearTimeout(debounce)

    if (value.trim().length < 2) {
      hits = []
      return
    }

    searching = true
    debounce = setTimeout(async () => {
      hits = await workspace.search(value)
      searching = false
    }, 220)
  }

  async function openHit(hit: Hit) {
    await workspace.open(hit.path)
    ongoto?.(hit.line)
  }

  /** Pinned entries, in the order they were pinned. One that has since been
   *  deleted simply does not appear. */
  const pinned = $derived.by(() => {
    const byPath = new Map<string, Entry>()

    const walk = (entries: Entry[]) => {
      for (const entry of entries) {
        byPath.set(entry.path, entry)
        if (entry.children?.length) walk(entry.children)
      }
    }

    if (workspace.tree) walk(workspace.tree.children)
    return workspace.pinned.map((path) => byPath.get(path)).filter((entry) => !!entry)
  })

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

  /** The width is a habit of the machine, not of the account: a laptop and a
   *  wide monitor want different ones, so it is kept here and not synced. */
  const WIDTH_KEY = 'nib:sidebar-width'
  const NARROWEST = 180
  const WIDEST = 520

  function savedWidth(): number | null {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    return saved >= NARROWEST && saved <= WIDEST ? saved : null
  }

  /** Null means the default width from the theme tokens. */
  let width = $state<number | null>(savedWidth())
  let resizing = $state(false)
  let aside = $state<HTMLElement>()

  /** The edge follows the pointer; letting go keeps the width. Pointer
   *  capture keeps the events coming even once the pointer has left the thin
   *  handle, which it does in the first few pixels of any drag. */
  function startResize(event: PointerEvent) {
    if (viewport.phone || event.button !== 0 || !aside) return

    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const from = aside.getBoundingClientRect().width

    handle.setPointerCapture(event.pointerId)
    resizing = true
    // The document keeps its own cursor and selection out of the way for
    // the length of the drag.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (moved: PointerEvent) => {
      width = Math.round(Math.min(WIDEST, Math.max(NARROWEST, from + moved.clientX - startX)))
    }

    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      resizing = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (width !== null) localStorage.setItem(WIDTH_KEY, String(width))
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  /** Double-clicking the edge puts the default back. */
  function resetWidth() {
    width = null
    localStorage.removeItem(WIDTH_KEY)
  }
</script>

<!-- On a desktop the sidebar slides open and shut, and the document slides
     with it, because the width is what animates rather than the opacity. On
     a phone the drawer it sits in is what moves, and this must be its full
     width the moment it exists, or the drag that opened it measures a
     sidebar still growing. -->
<aside
  bind:this={aside}
  class:resizing
  style:width={width !== null && !viewport.phone ? `${width}px` : undefined}
  transition:slide={{ axis: 'x', duration: viewport.phone ? 0 : 210, easing: cubicOut }}
>
  <!-- The strip along the right edge that changes the width. Not on a phone,
       where the drawer is as wide as the drawer is. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="edge"
    title={t('Drag to resize')}
    onpointerdown={startResize}
    ondblclick={resetWidth}
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
  </div>

  <!-- Rebuilt for each space, and arriving from the side of the rail the new
       space is on. -->
  {#key workspace.activeSpaceId}
  <div class="body" in:fly={{ y: 16 * direction, duration: 220, easing: cubicOut }}>
    {#if workspace.panel === 'tree'}
      {#if workspace.tree}
        {#if pinned.length}
          <ul class="pinned">
            {#each pinned as entry (entry.path)}
              <li>
                <button
                  class="row"
                  class:active={workspace.active?.path === entry.path}
                  onclick={() => !entry.is_dir && workspace.open(entry.path, { preview: true })}
                  ondblclick={() => !entry.is_dir && workspace.open(entry.path)}
                  oncontextmenu={(event) =>
                    menu.show(
                      event,
                      [{ label: t('Unpin'), run: () => workspace.togglePin(entry.path) }],
                      { title: entry.is_dir ? entry.name : stripped(entry.name) },
                    )}
                >
                  <span class="label">{entry.is_dir ? entry.name : stripped(entry.name)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

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
          oncontextmenu={(event) =>
            menu.show(event, spaceMenu(), { title: workspace.activeSpace?.name })}
          onclick={() => (workspace.renaming = null)}
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
              >
                <span class="label">{heading.text}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-text">{t('No headings in this note')}</p>
      {/if}
    {:else if workspace.panel === 'search'}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="query"
        value={query}
        oninput={(event) => onQuery(event.currentTarget.value)}
        placeholder={t('Search this space')}
        spellcheck="false"
        autofocus
      />

      {#if hits.length}
        <ul>
          {#each hits as hit, index (hit.path + hit.line + index)}
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
     shown the way a pick is. A pinned note that is open is not. */
  .row.heading.active {
    background: var(--active-file-bg-color);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .query {
    width: 100%;
    padding: 6px 9px;
    margin-bottom: var(--space-2);
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

  .pinned {
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
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
