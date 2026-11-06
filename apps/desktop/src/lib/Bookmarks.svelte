<script lang="ts">
  import { onMount } from 'svelte'
  import { flip } from 'svelte/animate'
  import { cubicOut } from 'svelte/easing'
  import { scale } from 'svelte/transition'
  import { door } from '@orden/markdown/door'
  import BookmarkTile from './BookmarkTile.svelte'
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { bookmarkEntry, DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { dur } from './motion'
  import Twist from './Twist.svelte'
  import { longPress } from './longpress'
  import { howFor, middleOpens, type OpenHow, type TabAsk, tabAsk } from './new-tab'
  import { roving } from './roving'
  import { GRAPH_MARK, SEARCH_MARK } from './panel-marks'
  import { rowName } from './note-name'
  import {
    carried,
    carriedNothing,
    carriedRows,
    carryBookmark,
    draggedBookmark,
    isTreeDrag,
  } from './drag-paths'
  import { insideSpace, samePath } from './space-paths'
  import { type Bookmark, isTile, sameBookmark } from './workspace/bookmarks.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'

  const { onsearch }: { onsearch: (query: string) => void } = $props()

  interface Row {
    mark: Bookmark
    at: number
    depth: number
    label: string
    note: string | null
    path: string | null
    kind: Mark | null
    active: boolean
    front: boolean
    unloaded: boolean
  }

  function essentialOf(path: string | null) {
    return path === null
      ? undefined
      : workspace.tabs.find((one) => one.essential !== null && samePath(one.essential, path))
  }

  const byPath = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const found = new Map<string, Entry>()

    const walk = (entries: Entry[]) => {
      for (const entry of entries) {
        if (workspace.instructionsAt(entry.path)) continue
        found.set(entry.path, entry)
        if (entry.children.length) walk(entry.children)
      }
    }

    if (workspace.tree) walk(workspace.tree.children)
    return found
  })

  function rowFor(mark: Bookmark, at: number, depth: number, root: string): Row | null {
    const shared = { mark, at, depth }

    if (mark.kind === 'group' || mark.kind === 'search' || mark.kind === 'graph') {
      return {
        ...shared,
        label: mark.text,
        note: null,
        path: null,
        kind: null,
        active: false,
        front: false,
        unloaded: false,
      }
    }

    const inside = mark.kind === 'block' ? (mark.path.split('#')[0] ?? '') : mark.path
    const entry = byPath.get(insideSpace(root, inside))
    if (!entry) return null

    const named = mark.kind === 'heading' || mark.kind === 'block'
    return {
      ...shared,
      label: named ? mark.text : rowName(entry.name, entry.is_dir),
      note: named ? rowName(entry.name, entry.is_dir) : null,
      path: entry.path,
      kind: entry.is_dir ? 'file' : fileMark(entry.name),
      active:
        !entry.is_dir &&
        (mark.kind === 'note'
          ? samePath(workspace.active?.essential ?? null, entry.path)
          : workspace.active?.path === entry.path),
      front:
        !entry.is_dir &&
        mark.kind === 'note' &&
        !workspace.active?.essential &&
        samePath(workspace.active?.path ?? null, entry.path),
      unloaded: mark.kind === 'note' && !!essentialOf(entry.path)?.unloaded,
    }
  }

  const drawn = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const list = workspace.bookmarks.list
    const out: Row[] = []

    const walk = (parent: string | undefined, depth: number) => {
      for (const [at, mark] of list.entries()) {
        if ((mark.parent ?? undefined) !== parent) continue

        const row = rowFor(mark, at, depth, root)
        if (!row) continue

        out.push(row)
        if (mark.kind === 'group' && workspace.isGroupOpen(mark.path)) walk(mark.path, depth + 1)
      }
    }

    walk(undefined, 0)
    return out
  })

  const tiles = $derived(
    workspace.device.essentialTiles ? drawn.filter((row) => isTile(row.mark)) : [],
  )
  const rows = $derived(
    workspace.device.essentialTiles ? drawn.filter((row) => !isTile(row.mark)) : drawn,
  )

  const offered = $derived.by(() => {
    if (!workspace.device.essentialTiles || !workspace.panes.dragging) return false
    if (workspace.panes.dragging.tabId === null) {
      return carried().some((one) => workspace.entryAt(one)?.is_dir === false)
    }

    const id = workspace.panes.dragging.tabId
    const path = id ? workspace.tabs.find((one) => one.id === id)?.path : null
    const mark = path ? workspace.bookmarks.forEntry({ path, is_dir: false }) : null
    return mark !== null && !workspace.bookmarks.has(mark)
  })

  const reckoning = door(() => import('./essentials.svelte'))
  let hands = $state.raw<typeof import('./essentials.svelte') | null>(null)
  const reach = () => {
    if (!hands) void reckoning().then((one) => (hands = one))
  }
  $effect(() => {
    if (workspace.panes.dragging) reach()
  })
  const landing = $derived(hands?.landing ?? null)

  function early(event: DragEvent) {
    if (!isTreeDrag(event.dataTransfer)) return
    event.preventDefault()
    reach()
  }

  function late(event: DragEvent) {
    if (!isTreeDrag(event.dataTransfer)) return
    event.preventDefault()
    const rows = carriedRows(event.dataTransfer)
    const at = workspace.bookmarks.list.length
    void reckoning().then((one) => one.keepRows(rows, at, (path) => byPath.get(path)))
  }

  let dragging = $state<number | null>(null)

  function open(row: Row, how: OpenHow) {
    const mark = row.mark

    switch (mark.kind) {
      case 'note':
        if (row.path) void workspace.openEntry(row.path, how)
        break
      case 'folder':
        if (row.path) workspace.revealFolder(row.path)
        break
      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text, how)
        break
      case 'search':
        onsearch(mark.text)
        break
      case 'block':
        void workspace.openAtBlock(mark.path, how)
        break
      case 'group':
        workspace.toggleGroup(mark.path)
        break
      case 'graph':
        workspace.graphSettings.take(mark.view)
        workspace.openGraph()
        break
    }
  }

  function pressed(row: Row, ask: TabAsk) {
    if (row.mark.kind === 'note' && row.path) {
      const path = row.path
      void reckoning().then((one) =>
        ask === 'plain' ? one.openEssential(path) : one.openInStrip(path, howFor(ask)),
      )
      return
    }

    open(row, howFor(ask, { preview: true }))
  }

  function keepAsTab(row: Row) {
    const path = row.path
    if (path) void reckoning().then((one) => one.keepAsTab(path))
  }

  let letters = $state.raw<typeof import('./tab-strip/letters.svelte') | null>(null)
  onMount(() => {
    void import('./tab-strip/letters.svelte').then((one) => (letters = one))
  })

  function letterOf(row: Row): { 'data-essential-letter'?: string; 'aria-keyshortcuts'?: string } {
    const given = letters?.essentialLetters.given
    const letter = given && row.path && isTile(row.mark) ? given[row.path] : undefined
    return letter ? { 'data-essential-letter': letter, 'aria-keyshortcuts': `Alt+${letter}` } : {}
  }

  function startDrag(event: DragEvent, row: Row) {
    reach()
    carryBookmark(event.dataTransfer, row.at, isTile(row.mark))
    dragging = row.at
  }

  function endDrag() {
    landing?.clear()
    dragging = null
    carriedNothing()
  }

  function over(event: DragEvent, row: Row) {
    if (!hands?.takes(event)) return

    landing?.over(row.at, dragging !== null && dragging < row.at)
  }

  function drop(event: DragEvent, row: Row) {
    event.preventDefault()

    const after = landing?.after ?? false
    if (hands?.keepCarried(event, after ? row.at + 1 : row.at, (path) => byPath.get(path))) {
      endDrag()
      return
    }

    const from = draggedBookmark(event.dataTransfer)
    endDrag()
    if (from === null) return

    const moving = workspace.bookmarks.list[from]
    if (!moving) return

    if (row.mark.kind === 'group' && !sameBookmark(moving, row.mark)) {
      workspace.bookmarks.moveInto(moving, row.mark.path)
      workspace.openGroup(row.mark.path)
      return
    }

    workspace.bookmarks.moveInto(moving, row.mark.parent ?? null)
    workspace.bookmarks.move(from, row.at)
  }

  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)

  function rowMenu(row: Row, unloading: MenuEntry[] = []): MenuEntry[] {
    const group = row.mark.kind === 'group'

    return [
      ...(row.mark.kind === 'note' && row.path
        ? [{ label: t('Open in new tab'), run: () => pressed(row, 'front') }, DIVIDER]
        : []),
      ...(unloading.length ? [...unloading, DIVIDER] : []),
      ...(group
        ? [
            { label: t('Rename'), run: () => void renameGroup(row.mark) },
            { label: t('Remove group'), run: () => workspace.bookmarks.remove(row.mark) },
          ]
        : bookmarkEntry(row.mark)),
      ...(row.mark.parent
        ? [
            {
              label: t('Out of the group'),
              run: () => workspace.bookmarks.moveInto(row.mark, null),
            },
          ]
        : []),
      DIVIDER,
      { label: t('New group'), run: () => void newGroup() },
    ]
  }

  function showMenu(event: MouseEvent, row: Row) {
    const own = row.mark.kind === 'note' ? essentialOf(row.path) : undefined
    if (!own) {
      menu.show(event, rowMenu(row), { title: titleOf(row) })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void import('./tab-strip/unloading.svelte').then(({ unloadEntries }) =>
      menu.show(event, rowMenu(row, unloadEntries(own)), { title: titleOf(row) }),
    )
  }

  async function newGroup() {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.ask({ title: t('New group'), confirmLabel: t('Make') })
    if (name) workspace.bookmarks.addGroup(name)
  }

  async function renameGroup(mark: Bookmark) {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.ask({
      title: t('Rename'),
      value: mark.text,
      confirmLabel: t('Rename'),
    })
    if (name) workspace.bookmarks.rename(mark, name)
  }

  const rowAt = (element: HTMLElement) => drawn.find((one) => one.at === Number(element.dataset.at))
</script>

{#if drawn.length || offered}
  <div
    class="bookmarks"
    onpointerenter={reach}
    onfocusin={reach}
    ondragenter={reach}
    use:roving={{
      current: '.is-on',
      rows: '.tile, .row',
      label: (element) => element.getAttribute('aria-label') ?? element.textContent,
      sideways: (key, element) => {
        if (element.classList.contains('tile')) return hands?.along(key, element) ?? false

        const row = rowAt(element)
        if (row?.mark.kind !== 'group') return false

        const open = workspace.isGroupOpen(row.mark.path)
        if (key === 'ArrowRight' && !open) workspace.toggleGroup(row.mark.path)
        else if (key === 'ArrowLeft' && open) workspace.toggleGroup(row.mark.path)
        else return false

        return true
      },
      remove: (element) => {
        const row = rowAt(element)
        if (row) workspace.bookmarks.remove(row.mark)
      },
      open: (element) => element.click(),
      peek: (element) => {
        element.click()
        element.focus()
      },
      menu: (element, at) => element.dispatchEvent(at),
    }}
  >
    {#if tiles.length || offered}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <ul
        class="nib-tiles tiles"
        class:is-taking={(landing?.at ?? null) !== null && !tiles.length}
        class:is-floating={!tiles.length}
        data-bookmark-drop
        aria-label={t('Essentials')}
        onkeydown={(event) => hands?.gridKey(event)}
        ondragover={(event) => (hands ? hands.overGrid(event) : early(event))}
        ondragleave={(event) => hands?.leaving(event)}
        ondrop={(event) =>
          hands ? hands.dropOnGrid(event, (path) => byPath.get(path)) : late(event)}
      >
        {#each tiles as tile (`${tile.mark.kind}:${tile.mark.path}`)}
          <li
            animate:flip={{ duration: dur(150), easing: cubicOut }}
            in:scale={{ start: 0.9, duration: dur(150), easing: cubicOut }}
            out:scale={{ start: 0.9, duration: dur(150), easing: cubicOut }}
          >
            <BookmarkTile
              path={tile.path ?? ''}
              name={tile.label}
              mark={tile.kind ?? 'note'}
              active={tile.active}
              front={tile.front}
              unloaded={tile.unloaded}
              slot={landing?.at === tile.at ? (landing.after ? 'after' : 'before') : null}
              data-at={tile.at}
              {...letterOf(tile)}
              onopen={(ask: TabAsk) => pressed(tile, ask)}
              ondblclick={(event: MouseEvent) => tabAsk(event) === 'plain' && keepAsTab(tile)}
              onmenu={(event: MouseEvent) => showMenu(event, tile)}
              ondragstart={(event: DragEvent) => startDrag(event, tile)}
              ondragend={endDrag}
            />
          </li>
        {:else}
          <li class="is-empty" aria-hidden="true"></li>
        {/each}
      </ul>
    {/if}

    {#if rows.length}
      <p class="nib-section">{t('Essentials')}</p>

      <ul class="list" data-bookmark-drop={workspace.device.essentialTiles ? undefined : ''}>
        {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
          {@const showing = workspace.isGroupOpen(row.mark.path)}
          {@const lands = landing?.at === row.at}
          <li>
            <div class="line">
              {#if row.mark.kind === 'group'}
                <button
                  class="twist"
                  style:--level={row.depth}
                  aria-expanded={showing}
                  aria-label={row.label}
                  onclick={() => workspace.toggleGroup(row.mark.path)}
                >
                  <span class="chevron"><Twist open={showing} /></span>
                </button>
              {/if}
              <button
                class="nib-row row"
                class:is-quiet={row.mark.kind === 'folder'}
                class:is-on={row.active}
                class:is-unloaded={row.unloaded}
                class:above={lands && !landing.after}
                class:below={lands && landing.after}
                class:nested={row.mark.kind !== 'group'}
                style:--level={row.depth}
                data-at={row.at}
                {...letterOf(row)}
                draggable="true"
                onclick={(event) => pressed(row, tabAsk(event))}
                ondblclick={(event) =>
                  tabAsk(event) === 'plain' &&
                  (row.mark.kind === 'note' ? keepAsTab(row) : open(row, {}))}
                use:middleOpens={(event) => pressed(row, tabAsk(event))}
                oncontextmenu={(event) => showMenu(event, row)}
                use:longPress={(event) => showMenu(event, row)}
                ondragstart={(event) => startDrag(event, row)}
                ondragover={(event) => over(event, row)}
                ondragleave={(event) => hands?.leaving(event)}
                ondragend={endDrag}
                ondrop={(event) => drop(event, row)}
              >
                {#if row.kind && row.path}
                  <FileMark mark={row.kind} path={row.path} />
                {:else if row.kind}
                  <FileMark mark={row.kind} />
                {:else if row.mark.kind === 'graph'}
                  <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
                {:else if row.mark.kind !== 'group'}
                  <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
                {/if}
                <span class="nib-row-label">{row.label}</span>
                {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .bookmarks {
    position: relative;
  }

  .tiles.is-floating {
    position: absolute;
    inset: 0 0 auto;
    margin-block: 0;
  }

  .tiles.is-floating .is-empty {
    height: calc(2 * var(--space-1) + 1lh);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .tiles.is-floating + .nib-section,
  .bookmarks:has(> .is-floating:only-child) + :global(.nib-section) {
    margin-top: 0;
    visibility: hidden;
  }

  .list {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
  }

  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    flex: none;
    min-height: var(--row-height-sm);
    display: flex;
    align-items: center;
    padding-inline-start: calc(var(--space-1) + var(--level, 0) * var(--row-indent));
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  .row {
    --lead: 2px;

    position: relative;
    flex: 1;
    min-width: 0;
    padding-inline-start: calc(var(--level, 0) * var(--row-indent) + var(--lead));
  }

  .row.is-unloaded > :global(.mark) {
    opacity: 0.45;
  }

  .row.nested {
    --lead: calc(var(--icon-md) + var(--space-1));
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
