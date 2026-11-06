<script lang="ts">
  import { tick } from 'svelte'
  import { fileMark } from '../file-mark'
  import FileMark from '../FileMark.svelte'
  import { t } from '../i18n.svelte'
  import { spelled, type Spelling } from '../list-keys'
  import { shortcuts } from '../shortcuts.svelte'
  import { readableSize } from '../usage.svelte'
  import { walked } from '../walk'
  import { menu } from '../menu.svelte'
  import { when } from '../when'
  import { renamePath } from './changes'
  import type { Entry } from './commands'
  import { roomMenu, rowMenu } from './menu'
  import { openFile } from './open'
  import { endingOf, type SortKey } from './order'
  import type { How } from './picked'
  import { explorerPrefs } from './prefs.svelte'
  import type { ExplorerView } from './view.svelte'

  const { view }: { view: ExplorerView } = $props()

  let scroller = $state<HTMLElement>()
  let scrollTop = $state(0)
  let height = $state(0)
  let rowHeight = $state(28)
  let spelling: Spelling = { typed: '', typedAt: 0 }

  const SPARE = 8

  const rows = $derived(view.rows)
  const cursorAt = $derived(
    view.picked.cursor === null ? -1 : view.names.indexOf(view.picked.cursor),
  )
  const drawn = $derived.by(() => {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - SPARE)
    const last = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + SPARE)
    const at: number[] = []
    for (let one = first; one < last; one++) at.push(one)
    if (cursorAt >= 0 && (cursorAt < first || cursorAt >= last)) at.push(cursorAt)
    return at.sort((one, other) => one - other)
  })
  const entryAt = $derived(cursorAt >= 0 ? cursorAt : 0)

  export function focus() {
    const row = scroller?.querySelector<HTMLElement>('[data-entry]')
    ;(row ?? scroller)?.focus({ preventScroll: true })
  }

  function measure(node: HTMLElement) {
    if (node.offsetHeight > 0) rowHeight = node.offsetHeight
  }

  function reach(index: number) {
    const box = scroller
    if (!box) return
    const top = index * rowHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + rowHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + rowHeight - box.clientHeight
    requestAnimationFrame(() => {
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
    else void openFile(view.pathOf(entry.name), entry.name)
  }

  function page(): number {
    return Math.max(1, Math.floor((scroller?.clientHeight ?? rowHeight) / rowHeight) - 1)
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
    let to: number | null = null
    if (key === 'PageDown') to = Math.min(count - 1, (at ?? -1) + page())
    else if (key === 'PageUp') to = Math.max(0, (at ?? 0) - page())
    else if (key) to = walked(key, at, count)
    if (to !== null && count) {
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
  let band = $state<{ from: number; to: number; kept: string[] } | null>(null)
  let banded = $state(false)

  function bandStart(event: PointerEvent) {
    if (event.button !== 0 || (event.target !== scroller && event.target !== room) || !room) return
    const y = event.clientY - room.getBoundingClientRect().top
    const kept = event.ctrlKey || event.metaKey ? [...view.picked.names] : []
    band = { from: y, to: y, kept }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function bandMove(event: PointerEvent) {
    if (!band || !room) return
    band = { ...band, to: event.clientY - room.getBoundingClientRect().top }
    const top = Math.min(band.from, band.to)
    const bottom = Math.max(band.from, band.to)
    if (bottom - top < 4) return
    banded = true
    const first = Math.max(0, Math.floor(top / rowHeight))
    const last = Math.min(rows.length - 1, Math.floor(bottom / rowHeight))
    view.pickNames([...band.kept, ...view.names.slice(first, last + 1)])
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
      committing = true
      view.renaming = null
      committing = false
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
    { key: 'kind', label: () => t('Kind') },
  ]
</script>

<div class="list">
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

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="rows"
    role="listbox"
    tabindex="-1"
    aria-multiselectable="true"
    aria-label={view.folder ?? t('File explorer')}
    bind:this={scroller}
    bind:clientHeight={height}
    onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
    onkeydown={onkey}
    onclick={pressEmpty}
    onpointerdown={bandStart}
    onpointermove={bandMove}
    onpointerup={bandEnd}
    onpointercancel={bandEnd}
    oncontextmenu={roomMenuAt}
    data-entry={rows.length ? undefined : ''}
  >
    {#if view.wrong}
      <p class="said">{view.wrong}</p>
    {:else if view.listing && !rows.length}
      <p class="said">{t('This folder is empty.')}</p>
    {/if}
    <div class="room" bind:this={room} style:height="{rows.length * rowHeight}px">
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
            class="nib-row entry"
            class:is-picked={view.picked.names.has(entry.name)}
            class:is-quiet={entry.hidden}
            role="option"
            aria-selected={view.picked.names.has(entry.name)}
            tabindex={index === entryAt ? 0 : -1}
            data-index={index}
            data-entry={index === entryAt ? '' : undefined}
            style:top="{index * rowHeight}px"
            use:measure
            onclick={(event) => press(event, entry)}
            ondblclick={() => open(entry)}
            oncontextmenu={(event) => rowMenuAt(event, entry)}
          >
            <span class="name">
              <FileMark mark={entry.folder ? 'folder' : fileMark(entry.name)} />
              {#if view.renaming === entry.name}
                <input
                  class="nib-field rename"
                  value={entry.name}
                  aria-label={t('Rename')}
                  spellcheck="false"
                  autocomplete="off"
                  use:naming
                  onkeydown={(event) => nameKey(event, entry)}
                  onblur={(event) => void commit(entry, event.currentTarget.value)}
                  onclick={(event) => event.stopPropagation()}
                  ondblclick={(event) => event.stopPropagation()}
                />
              {:else}
                <span class="nib-row-label">{entry.name}</span>
              {/if}
            </span>
            <span class="nib-row-meta modified">{when(entry.modified, 'short')}</span>
            <span class="nib-row-meta size">{entry.folder ? '' : readableSize(entry.size)}</span>
            <span class="nib-row-meta kind">{kindOf(entry)}</span>
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
</style>
