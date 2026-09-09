<script lang="ts">
  /** The row of bookmarks above the file list: notes, folders, headings and
   *  searches, in the order they were put in and reorderable by dragging one
   *  over another.
   *
   *  A bookmark keeps a path the space speaks, so a note or folder that has
   *  since been deleted simply has no row. A search points at nothing on disk
   *  and is always there. */
  import { fileMark, type Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { bookmarkEntry, menu } from './menu.svelte'
  import { longPress } from './longpress'
  import { SEARCH_MARK } from './panel-marks'
  import { shownName } from './note-name'
  import { carryBookmark, draggedBookmark, isBookmarkDrag } from './drag-paths'
  import { insideSpace } from './space-paths'
  import type { Bookmark } from './workspace/bookmarks.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'

  const { onsearch }: { onsearch: (query: string) => void } = $props()

  interface Row {
    mark: Bookmark
    /** Where it sits in the list, which is what a drag moves. */
    at: number
    label: string
    /** The note a heading is in, shown muted after it. Null on every other kind. */
    note: string | null
    /** The file the row opens, or the folder it shows. Null for a search. */
    path: string | null
    /** The mark in front of the name, so a bookmark reads as the same kind of
     *  thing it is in the tree below. Null for a search, which wears the
     *  magnifier instead. */
    kind: Mark | null
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
        out.push({ mark, at, label: mark.text, note: null, path: null, kind: null, active: false })
        continue
      }

      const entry = byPath.get(insideSpace(root, mark.path))
      if (!entry) continue

      const open = !entry.is_dir && workspace.active?.path === entry.path
      out.push({
        mark,
        at,
        label: mark.kind === 'heading' ? mark.text : shownName(entry.name),
        note: mark.kind === 'heading' ? shownName(entry.name) : null,
        path: entry.path,
        kind: entry.is_dir ? 'folder' : fileMark(entry.name),
        active: open,
      })
    }

    return out
  })

  /** The row a drop would land on, and whether the line showing that sits above
   *  it or below: above when the row being dragged comes from further down. */
  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)
  /** Which row is being dragged. Kept here as well as in the drag itself
   *  because what a drag carries is sealed until it is dropped: while it is
   *  moving, a page may ask what kinds of thing it holds and not what they
   *  are, and the line showing where it would land has to know which way it
   *  came from. */
  let dragging = $state<number | null>(null)

  function open(row: Row, preview: boolean) {
    const mark = row.mark

    switch (mark.kind) {
      case 'note':
        if (row.path) void workspace.openEntry(row.path, preview ? { preview: true } : {})
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
    dragging = row.at
  }

  function endDrag() {
    dropAt = null
    dragging = null
  }

  function over(event: DragEvent, row: Row) {
    if (!isBookmarkDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    dropAt = row.at
    // The line marks the edge the row would arrive at, which is the near side
    // of the target: its top when the row is coming down the list, its bottom
    // when it is going up.
    dropAbove = dragging !== null && dragging > row.at
  }

  function drop(event: DragEvent, row: Row) {
    event.preventDefault()

    const from = draggedBookmark(event.dataTransfer)
    endDrag()
    if (from !== null) workspace.bookmarks.move(from, row.at)
  }

  /** What the menu is about, for the sheet a phone heads its menus with. */
  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)
</script>

{#if rows.length}
  <p class="nib-section">{t('Bookmarks')}</p>

  <ul>
    {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
      <li>
        <button
          class="nib-row row"
          class:is-quiet={row.mark.kind === 'folder'}
          class:is-on={row.active}
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
          ondragend={endDrag}
          ondrop={(event) => drop(event, row)}
        >
          <!-- Every row wears one, so every name in the panel starts at the
               same place: the kind the file is in the tree below, or the
               magnifier for a search, which points at no file at all. -->
          {#if row.kind && row.path}
            <FileMark mark={row.kind} path={row.path} />
          {:else if row.kind}
            <FileMark mark={row.kind} />
          {:else}
            <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
          {/if}
          <span class="nib-row-label">{row.label}</span>
          {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
  }

  /* The row is `.nib-row`, drawn in the themes package. What is left here is the
     line saying where a dragged row would land: along the edge it arrives at,
     rather than a box around the row it is passing. */
  .row {
    position: relative;
  }

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

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }
</style>
