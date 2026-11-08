<script lang="ts">
  import { carried, dropOver } from '../drag-paths'
  import { tick, untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { spelled, type Spelling } from '../list-keys'
  import { shortcuts } from '../shortcuts.svelte'
  import { readableSize } from '../usage.svelte'
  import { steppedKey } from '../direction'
  import { isPicturePath, nameOf, folderOf, samePath } from '../space-paths'
  import { menu } from '../menu.svelte'
  import { when } from '../when'
  import { renamePath } from './changes'
  import { dropInto, endDrag, over, startDrag } from './drag'
  import EntryMark from './EntryMark.svelte'
  import type { Entry } from './commands'
  import { stepped } from './keys'
  import { roomMenu, rowMenu } from './menu'
  import { openFile } from './open'
  import { endingOf, type SortKey } from './order'
  import type { How } from './picked'
  import { explorerPrefs } from './prefs.svelte'
  import { THUMB_MOST, Thumbs } from './thumbs'
  import type { ExplorerView } from './view.svelte'

  const { view }: { view: ExplorerView } = $props()

  let scroller = $state<HTMLElement>()
  let scrollTop = $state(0)
  let height = $state(0)
  let width = $state(0)
  let rowHeight = $state(28)
  let spelling: Spelling = { typed: '', typedAt: 0 }

  const SPARE = 8
  const TILE = 112

  const rows = $derived(view.rows)
  const grid = $derived(explorerPrefs.view === 'grid')
  const columns = $derived(grid ? Math.max(1, Math.floor(Math.max(0, width - 16) / TILE)) : 1)
  const lineHeight = $derived(grid ? TILE : rowHeight)
  const lines = $derived(Math.ceil(rows.length / columns))
  const cursorAt = $derived(
    view.picked.cursor === null ? -1 : view.names.indexOf(view.picked.cursor),
  )
  const drawn = $derived.by(() => {
    const firstLine = Math.max(0, Math.floor(scrollTop / lineHeight) - SPARE)
    const lastLine = Math.min(lines, Math.ceil((scrollTop + height) / lineHeight) + SPARE)
    const first = firstLine * columns
    const last = Math.min(rows.length, lastLine * columns)
    const at: number[] = []
    for (let one = first; one < last; one++) at.push(one)
    if (cursorAt >= 0 && (cursorAt < first || cursorAt >= last)) at.push(cursorAt)
    return at.sort((one, other) => one - other)
  })

  const thumbs = new Thumbs()

  $effect(() => {
    if (!grid) {
      untrack(() => thumbs.clear())
      return
    }
    const wanted = drawn.flatMap((index) => {
      const entry = rows[index]
      if (!entry || entry.folder || entry.size > THUMB_MOST || !isPicturePath(entry.name)) return []
      const stamp = `${entry.size}:${entry.modified}`
      return [{ path: view.pathOf(entry.name), name: entry.name, stamp }]
    })
    const folder = view.listing?.path ?? null
    untrack(() => thumbs.want(folder, wanted))
  })

  $effect(() => () => {
    thumbs.clear()
    clearTimeout(opening)
  })

  const entryAt = $derived(cursorAt >= 0 ? cursorAt : 0)

  export function focus() {
    const row = scroller?.querySelector<HTMLElement>('[data-entry]')
    ;(row ?? scroller)?.focus({ preventScroll: true })
  }

  function measure(node: HTMLElement) {
    if (!node.classList.contains('tile') && node.offsetHeight > 0) rowHeight = node.offsetHeight
  }

  function reach(index: number) {
    const box = scroller
    if (!box) return
    const top = Math.floor(index / columns) * lineHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + lineHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + lineHeight - box.clientHeight
    void tick().then(() => {
      box.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true })
    })
  }

  function landOn(index: number, how: How) {
    const name = view.names[index]
    if (name === undefined) return
    view.pick(name, how)
    reach(index)
  }

  function open(entry: Entry) {
    if (entry.folder) void view.go(view.pathOf(entry.name))
    else void openFile(view.pathOf(entry.name))
  }

  function page(): number {
    return Math.max(1, Math.floor((scroller?.clientHeight ?? lineHeight) / lineHeight) - 1)
  }

  function onkey(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const pressed = (id: string) => shortcuts.pressed(id, event)
    const count = rows.length
    const at = cursorAt >= 0 ? cursorAt : null

    if (pressed('tree.select-all')) {
      event.preventDefault()
      view.pickAll()
      return
    }
    if (pressed('tree.deselect') && view.picked.names.size) {
      event.preventDefault()
      view.pickNone()
      return
    }
    if (pressed('tree.open') && at !== null) {
      event.preventDefault()
      const entry = rows[at]
      if (entry) open(entry)
      return
    }
    if (pressed('tree.toggle') && view.picked.cursor !== null) {
      event.preventDefault()
      view.pick(view.picked.cursor, 'toggle')
      return
    }

    const extend = pressed('tree.extend-down')
      ? 'ArrowDown'
      : pressed('tree.extend-up')
        ? 'ArrowUp'
        : null
    const plain = pressed('tree.down') ? 'ArrowDown' : pressed('tree.up') ? 'ArrowUp' : null
    const key = extend ?? plain ?? (event.altKey ? null : event.key)
    const how: How = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'move' : 'one'
    if (explorerPrefs.view === 'columns' && key && !event.shiftKey) {
      const side = steppedKey(key)
      const entry = at === null ? null : rows[at]
      if (side === 'ArrowRight' && entry?.folder) {
        event.preventDefault()
        void view.go(view.pathOf(entry.name))
        return
      }
      if (side === 'ArrowLeft') {
        event.preventDefault()
        void view.up()
        return
      }
    }
    const to = key ? stepped(steppedKey(key), at, count, columns, page()) : null
    if (to !== null) {
      event.preventDefault()
      landOn(to, how)
      return
    }

    if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const spelt = spelled(spelling, event.key, event.timeStamp, view.names)
      spelling = { typed: spelt.typed, typedAt: spelt.typedAt }
      if (spelt.found >= 0) {
        event.preventDefault()
        landOn(spelt.found, 'one')
      }
    }
  }

  function press(event: MouseEvent, entry: Entry) {
    const how: How = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'one'
    view.pick(entry.name, how)
  }

  function pressEmpty(event: MouseEvent) {
    if (banded) banded = false
    else if (event.target === event.currentTarget || event.target === room) view.pickNone()
  }

  let room = $state<HTMLElement>()
  let band = $state<{
    from: number
    to: number
    fromX: number
    toX: number
    kept: string[]
  } | null>(null)
  let banded = $state(false)

  function bandStart(event: PointerEvent) {
    if (event.button !== 0 || (event.target !== scroller && event.target !== room) || !room) return
    const box = room.getBoundingClientRect()
    const y = event.clientY - box.top
    const x = event.clientX - box.left
    const kept = event.ctrlKey || event.metaKey ? [...view.picked.names] : []
    band = { from: y, to: y, fromX: x, toX: x, kept }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function bandMove(event: PointerEvent) {
    if (!band || !room) return
    const box = room.getBoundingClientRect()
    band = { ...band, to: event.clientY - box.top, toX: event.clientX - box.left }
    const top = Math.min(band.from, band.to)
    const bottom = Math.max(band.from, band.to)
    if (bottom - top < 4 && Math.abs(band.toX - band.fromX) < 4) return
    banded = true
    const firstLine = Math.max(0, Math.floor(top / lineHeight))
    const lastLine = Math.min(lines - 1, Math.floor(bottom / lineHeight))
    const ltr = getComputedStyle(room).direction !== 'rtl'
    const across = (x: number) => (ltr ? x : box.width - x)
    const firstColumn = grid
      ? Math.max(0, Math.floor(Math.min(across(band.fromX), across(band.toX)) / TILE))
      : 0
    const lastColumn = grid
      ? Math.min(columns - 1, Math.floor(Math.max(across(band.fromX), across(band.toX)) / TILE))
      : 0
    const names: string[] = []
    for (let line = firstLine; line <= lastLine; line++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const name = view.names[line * columns + column]
        if (name !== undefined) names.push(name)
      }
    }
    view.pickNames([...band.kept, ...names])
  }

  function bandEnd() {
    band = null
  }

  function rowMenuAt(event: MouseEvent, entry: Entry) {
    event.preventDefault()
    menu.show(event, rowMenu(view, entry))
  }

  function roomMenuAt(event: MouseEvent) {
    if (event.target !== scroller && event.target !== room) return
    event.preventDefault()
    menu.show(event, roomMenu(view))
  }

  export function menuHere() {
    const entry = rows[cursorAt]
    const row = scroller?.querySelector<HTMLElement>(`[data-index="${cursorAt}"]`)
    if (!entry || !row) return
    const box = row.getBoundingClientRect()
    menu.show(
      new MouseEvent('contextmenu', { clientX: box.left + 24, clientY: box.bottom }),
      rowMenu(view, entry),
    )
  }

  function naming(field: HTMLInputElement) {
    void tick().then(() => {
      field.focus()
      const dot = field.value.lastIndexOf('.')
      field.setSelectionRange(0, dot > 0 ? dot : field.value.length)
    })
  }

  let taking = $state<string | null>(null)
  let opening: ReturnType<typeof setTimeout> | undefined

  function dragFrom(event: DragEvent, entry: Entry) {
    if (!view.picked.names.has(entry.name)) view.pick(entry.name, 'one')
    startDrag(event, view.chosen)
  }

  function carriesItself(entry: Entry): boolean {
    const path = view.pathOf(entry.name)
    return carried().some((one) => samePath(one, path))
  }

  function overRow(event: DragEvent, entry: Entry) {
    if (!entry.folder || carriesItself(entry)) return
    if (!over(event)) return
    event.stopPropagation()
    if (taking === entry.name) return
    taking = entry.name
    clearTimeout(opening)
    opening = setTimeout(() => {
      if (taking === entry.name) void view.go(view.pathOf(entry.name))
    }, 800)
  }

  function leaveRow(entry: Entry) {
    if (taking !== entry.name) return
    taking = null
    clearTimeout(opening)
  }

  function dropOnRow(event: DragEvent, entry: Entry) {
    if (!entry.folder || carriesItself(entry)) return
    event.stopPropagation()
    taking = null
    clearTimeout(opening)
    dropInto(view, event, view.pathOf(entry.name))
  }

  function dropOnRoom(event: DragEvent) {
    const folder = view.listing?.path
    if (folder) dropInto(view, event, folder)
  }

  let committing = false

  async function commit(entry: Entry, name: string) {
    if (committing) return
    committing = true
    view.renaming = null
    try {
      await renamePath(view, view.pathOf(entry.name), name)
    } finally {
      committing = false
      focus()
    }
  }

  function nameKey(event: KeyboardEvent, entry: Entry) {
    const field = event.currentTarget as HTMLInputElement
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit(entry, field.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      view.renaming = null
      focus()
    }
    event.stopPropagation()
  }

  function kindOf(entry: Entry): string {
    if (entry.folder) return t('Folder')
    const ending = endingOf(entry.name)
    return ending ? ending.toUpperCase() : t('File')
  }

  const COLUMNS: { key: SortKey; label: () => string }[] = [
    { key: 'name', label: () => t('Name') },
    { key: 'modified', label: () => t('Modified') },
    { key: 'size', label: () => t('Size') },
    { key: 'kind', label: () => (view.search ? t('Folder') : t('Kind')) },
  ]
</script>

<div class="list" class:searching={!!view.search} class:narrow={explorerPrefs.view === 'columns'}>
  {#if !grid}
    <div class="head">
      {#each COLUMNS as column (column.key)}
        <button class="column {column.key}" onclick={() => explorerPrefs.sortBy(column.key)}>
          {column.label()}
          {#if explorerPrefs.sort.key === column.key}
            <span class="turn" aria-hidden="true">{explorerPrefs.sort.down ? '↓' : '↑'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="rows"
    role="listbox"
    tabindex="-1"
    aria-multiselectable="true"
    aria-label={view.folder ?? t('File explorer')}
    bind:this={scroller}
    bind:clientHeight={height}
    bind:clientWidth={width}
    onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
    onkeydown={onkey}
    onclick={pressEmpty}
    onpointerdown={bandStart}
    onpointermove={bandMove}
    onpointerup={bandEnd}
    onpointercancel={bandEnd}
    use:dropOver={(event) => over(event)}
    ondrop={dropOnRoom}
    oncontextmenu={roomMenuAt}
    data-entry={rows.length ? undefined : ''}
  >
    {#if view.wrong}
      <p class="said">{view.wrong}</p>
    {:else if view.listing && !rows.length}
      <p class="said">{t('This folder is empty.')}</p>
    {/if}
    <div class="room" bind:this={room} style:height="{lines * lineHeight}px">
      {#if band && banded}
        <div
          class="band"
          style:top="{Math.min(band.from, band.to)}px"
          style:height="{Math.abs(band.to - band.from)}px"
        ></div>
      {/if}
      {#each drawn as index (rows[index]?.name ?? index)}
        {@const entry = rows[index]}
        {#if entry}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="orden-row entry"
            class:tile={grid}
            class:is-picked={view.picked.names.has(entry.name)}
            class:is-taking={taking === entry.name}
            class:is-quiet={entry.hidden}
            role="option"
            aria-selected={view.picked.names.has(entry.name)}
            tabindex={index === entryAt ? 0 : -1}
            data-index={index}
            data-entry={index === entryAt ? '' : undefined}
            style:top="{Math.floor(index / columns) * lineHeight}px"
            style:inset-inline-start={grid ? `${(index % columns) * TILE}px` : undefined}
            use:measure
            onclick={(event) => press(event, entry)}
            ondblclick={() => open(entry)}
            oncontextmenu={(event) => rowMenuAt(event, entry)}
            draggable={view.renaming !== entry.name}
            ondragstart={(event) => dragFrom(event, entry)}
            ondragend={endDrag}
            use:dropOver={(event) => overRow(event, entry)}
            ondragleave={() => leaveRow(entry)}
            ondrop={(event) => dropOnRow(event, entry)}
          >
            {#if grid}
              <span class="face">
                {#if thumbs.shown.has(view.pathOf(entry.name))}
                  <img src={thumbs.shown.get(view.pathOf(entry.name))} alt="" draggable="false" />
                {:else}
                  <EntryMark path={view.pathOf(entry.name)} folder={entry.folder} />
                {/if}
              </span>
            {/if}
            <span class="name">
              {#if !grid}
                <EntryMark path={view.pathOf(entry.name)} folder={entry.folder} />
              {/if}
              {#if view.renaming === entry.name}
                <input
                  class="orden-field rename"
                  value={view.search ? nameOf(entry.name) : entry.name}
                  aria-label={t('Rename')}
                  spellcheck="false"
                  autocomplete="off"
                  use:naming
                  onkeydown={(event) => nameKey(event, entry)}
                  onblur={(event) => {
                    if (view.renaming === entry.name) void commit(entry, event.currentTarget.value)
                  }}
                  onclick={(event) => event.stopPropagation()}
                  ondblclick={(event) => event.stopPropagation()}
                />
              {:else}
                <span class="orden-row-label" dir="auto"
                  >{view.search ? nameOf(entry.name) : entry.name}</span
                >
                {#if view.search && folderOf(entry.name)}
                  <span class="where" dir="auto">{folderOf(entry.name)}</span>
                {/if}
              {/if}
            </span>
            {#if !grid}
              <span class="orden-row-meta modified">{when(entry.modified, 'short')}</span>
              <span class="orden-row-meta size">{entry.folder ? '' : readableSize(entry.size)}</span
              >
              <span class="orden-row-meta kind"
                >{view.search ? folderOf(entry.name) : kindOf(entry)}</span
              >
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .list {
    --columns: minmax(0, 1fr) 9.5rem 5.5rem 5.5rem;

    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  @container (max-width: 34rem) {
    .list {
      --columns: minmax(0, 1fr) 8.5rem 5rem;
    }

    .kind {
      display: none;
    }
  }

  @container (max-width: 22rem) {
    .list {
      --columns: minmax(0, 1fr) 5rem;
    }

    .modified {
      display: none;
    }
  }

  .head,
  .entry {
    display: grid;
    grid-template-columns: var(--columns);
    align-items: center;
  }

  .head {
    flex: none;
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .column {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    height: var(--row-height-sm);
    padding: 0 var(--row-pad);
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
  }

  @media (hover: hover) {
    .column:hover {
      color: var(--text-strong);
    }
  }

  .column.size {
    justify-content: flex-end;
  }

  .rows {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-2);
    overflow-y: auto;
  }

  .room {
    position: relative;
  }

  .entry {
    position: absolute;
    inset-inline: 0;
  }

  .list.narrow {
    --columns: minmax(0, 1fr) 5rem;
  }

  .list.narrow .modified,
  .list.narrow .kind {
    display: none;
  }

  .list.searching {
    --columns: minmax(0, 1fr) 9.5rem 5.5rem minmax(0, 0.8fr);
  }

  .where {
    display: none;
    flex: none;
    max-width: 45%;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list.searching.narrow {
    --columns: minmax(0, 1fr) 5rem;
  }

  .list.searching.narrow .where,
  .tile .where {
    display: block;
  }

  .list.searching .tile .name {
    flex-direction: column;
    gap: 0;
  }

  .tile .where {
    max-width: 100%;
  }

  @container (max-width: 34rem) {
    .list.searching {
      --columns: minmax(0, 1fr) 8.5rem 5rem;
    }

    .list.searching .where {
      display: block;
    }
  }

  @container (max-width: 22rem) {
    .list.searching {
      --columns: minmax(0, 1fr) 5rem;
    }
  }

  .entry.tile {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 112px;
    height: 104px;
    padding: var(--space-1);
    inset-inline-end: auto;
  }

  .face {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
  }

  .face img {
    max-width: 64px;
    max-height: 64px;
    border-radius: var(--radius-sm);
    object-fit: contain;
  }

  .face :global(.mark) {
    width: 40px;
    height: 40px;
  }

  .tile .name {
    justify-content: center;
    width: 100%;
    text-align: center;
  }

  .name {
    display: flex;
    gap: var(--row-gap);
    align-items: center;
    min-width: 0;
  }

  .size {
    text-align: end;
  }

  .rename {
    flex: 1;
    min-width: 0;
    min-height: 0;
    height: calc(var(--row-height) - var(--space-1));
  }

  .band {
    position: absolute;
    inset-inline: 0;
    z-index: var(--z-raised);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    pointer-events: none;
  }

  .said {
    margin: var(--space-6) var(--space-4);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  [dir='auto'] {
    text-align: match-parent;
  }
</style>
