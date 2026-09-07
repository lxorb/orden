<script lang="ts">
  /** The row of bookmarks above the file list: notes, folders, headings and
   *  searches, in the order they were put in and reorderable by dragging one
   *  over another.
   *
   *  A bookmark keeps a path the space speaks, so a note or folder that has
   *  since been deleted simply has no row. A search points at nothing on disk
   *  and is always there. */
  import { t } from './i18n.svelte'
  import { bookmarkEntry, menu } from './menu.svelte'
  import { longPress } from './longpress'
  import { carryBookmark, draggedBookmark, isBookmarkDrag } from './drag-paths'
  import { insideSpace } from './space-paths'
  import type { Bookmark } from './workspace/bookmarks.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'

  const { onsearch }: { onsearch: (query: string) => void } = $props()

  /** A magnifier, the same one the Search tab wears, so a bookmarked search
   *  says what it is without a word. */
  const SEARCH_ICON = 'M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3'

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  interface Row {
    mark: Bookmark
    /** Where it sits in the list, which is what a drag moves. */
    at: number
    label: string
    /** The note a heading is in, shown muted after it. Null on every other kind. */
    note: string | null
    /** The file the row opens, or the folder it shows. Null for a search. */
    path: string | null
    active: boolean
  }

  const byPath = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const found = new Map<string, Entry>()

    const walk = (entries: Entry[]) => {
      for (const entry of entries) {
        found.set(entry.path, entry)
        if (entry.children.length) walk(entry.children)
      }
    }

    if (workspace.tree) walk(workspace.tree.children)
    return found
  })

  const rows = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const out: Row[] = []

    for (const [at, mark] of workspace.bookmarks.list.entries()) {
      if (mark.kind === 'search') {
        out.push({ mark, at, label: mark.text, note: null, path: null, active: false })
        continue
      }

      const entry = byPath.get(insideSpace(root, mark.path))
      if (!entry) continue

      const open = !entry.is_dir && workspace.active?.path === entry.path
      out.push({
        mark,
        at,
        label: mark.kind === 'heading' ? mark.text : stripped(entry.name),
        note: mark.kind === 'heading' ? stripped(entry.name) : null,
        path: entry.path,
        active: open,
      })
    }

    return out
  })

  /** The row a drop would land on, and whether the line showing that sits above
   *  it or below: above when the row being dragged comes from further down. */
  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)

  function open(row: Row, preview: boolean) {
    const mark = row.mark

    switch (mark.kind) {
      case 'note':
        if (row.path) void workspace.open(row.path, preview ? { preview: true } : {})
        break
      case 'folder':
        if (row.path) workspace.revealFolder(row.path)
        break
      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text)
        break
      case 'search':
        onsearch(mark.text)
        break
    }
  }

  function startDrag(event: DragEvent, row: Row) {
    carryBookmark(event.dataTransfer, row.at)
  }

  function over(event: DragEvent, row: Row) {
    if (!isBookmarkDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    const from = draggedBookmark(event.dataTransfer)
    dropAt = row.at
    // The line marks the edge the row would arrive at, which is the near side
    // of the target: its top when it is coming down the list, its bottom when
    // it is going up.
    dropAbove = from !== null && from > row.at
  }

  function drop(event: DragEvent, row: Row) {
    event.preventDefault()
    dropAt = null

    const from = draggedBookmark(event.dataTransfer)
    if (from !== null) workspace.bookmarks.move(from, row.at)
  }

  /** What the menu is about, for the sheet a phone heads its menus with. */
  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)
</script>

{#if rows.length}
  <ul>
    {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
      <li>
        <button
          class="row"
          class:active={row.active}
          class:above={dropAt === row.at && dropAbove}
          class:below={dropAt === row.at && !dropAbove}
          draggable="true"
          onclick={() => open(row, true)}
          ondblclick={() => open(row, false)}
          oncontextmenu={(event) =>
            menu.show(event, bookmarkEntry(row.mark), { title: titleOf(row) })}
          use:longPress={(event) =>
            menu.show(event, bookmarkEntry(row.mark), {
              title: titleOf(row),
            })}
          ondragstart={(event) => startDrag(event, row)}
          ondragover={(event) => over(event, row)}
          ondragleave={() => (dropAt = null)}
          ondragend={() => (dropAt = null)}
          ondrop={(event) => drop(event, row)}
        >
          {#if row.mark.kind === 'search'}
            <svg viewBox="0 0 13 13"><path d={SEARCH_ICON} /></svg>
          {/if}
          <span class="label">{row.label}</span>
          {#if row.note}<span class="in">{row.note}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0 0 var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  /* The same row as the tree's, so the list above it reads as part of it. */
  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
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
      color var(--dur-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--item-hover-bg-color);
    color: var(--item-hover-text-color);
  }

  .row:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .row.active {
    color: var(--active-file-text-color);
    font-weight: 550;
  }

  /* Where the row being dragged would land: a line along the edge it arrives
     at, rather than a box around the row it is passing. */
  .row.above::before,
  .row.below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .row.above::before {
    top: -1px;
  }

  .row.below::after {
    bottom: -1px;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Which note a bookmarked heading is in: after the heading, and quiet enough
     that the heading is still what the row says. */
  .in {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  svg {
    width: 11px;
    height: 11px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Same floor as the tree rows beneath them: everything in the drawer is
     something a thumb has to land on. */
  @media (max-width: 720px) {
    .row {
      min-height: 48px;
      padding-top: 0;
      padding-bottom: 0;
      font-size: var(--text-base);
    }

    svg {
      width: 14px;
      height: 14px;
    }
  }
</style>
