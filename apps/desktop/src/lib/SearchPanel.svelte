<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { shownName } from './platform/src/api'
  import { ARCHIVE_MARK } from './archive-marks'
  import { SEARCH_MARK } from './panel-marks'
  import { roving } from './roving'
  import { howFor, middleOpens, tabAsk } from './new-tab'
  import { search } from './search.svelte'
  import { OPERATORS } from '@orden/scan/search/query'
  import { warm } from './search/warm.svelte'
  import { chosen, completing, naming, nearest, offered } from './search/suggest'
  import type { Hit, Range } from '@orden/scan/search/match'
  import { taskOf } from './search/task'
  import { relativeTo } from './platform/src/api'
  import Suggest from './Suggest.svelte'
  import { nodesIn, tagTree } from './tag-tree'
  import TagTree from './TagTree.svelte'
  import { isScratchpad } from './scratchpad/is.svelte'
  import { canWriteAt } from './sharing/src/api'
  import { type Entry, workspace } from './workspace.svelte'
  import { dur, fly } from './platform/src/api'

  const { ongoto }: { ongoto?: ((line: number) => void) | undefined } = $props()

  const STAR =
    'M6.5 1.6l1.55 3.14 3.47.5-2.51 2.45.59 3.45L6.5 9.5 3.4 11.14l.59-3.45L1.48 5.24l3.47-.5z'

  const SWAP = 'M1.8 4h7.4M7.4 2.2 9.2 4 7.4 5.8M11.2 9H3.8M5.6 7.2 3.8 9l1.8 1.8'

  const TICK = 'M2.6 6.6 5 9l5.4-5.4'

  const writable = $derived(canWriteAt(workspace.activeSpace?.root ?? ''))

  let field = $state<HTMLInputElement>()

  $effect(() => {
    if (!field) return
    const end = field.value.length
    field.setSelectionRange(end, end)
    caret = end
  })
  let focused = $state(false)
  let shut = $state(false)
  let caret = $state(0)
  let active = $state(0)

  const folders = $derived.by(() => {
    const root = workspace.activeSpace?.root
    const tree = workspace.tree
    if (!root || !tree) return []

    const out: string[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (!child.is_dir) continue

        out.push(`${relativeTo(root, child.path).replace(/\\/g, '/')}/`)
        walk(child)
      }
    }

    walk(tree)
    return out.sort()
  })

  const names = $derived(
    [
      ...new Set(
        workspace.notes
          .filter((note) => search.archived || !workspace.archive.has(note.path))
          .map((note) => shownName(note.name)),
      ),
    ].sort(),
  )

  const tags = $derived(tagTree(workspace.tags))

  const tagPaths = $derived(nodesIn(tags).map((node) => node.path))

  const asking = $derived(
    focused && !shut ? (completing(search.text, caret) ?? naming(search.text, caret)) : null,
  )

  const suggestions = $derived.by(() => {
    if (!asking) return []
    if (asking.field === 'name') return offered(asking.typed, OPERATORS)
    if (asking.field === 'tag') return nearest(asking.typed, tagPaths)
    return offered(asking.typed, asking.field === 'path' ? folders : names)
  })

  $effect(() => {
    search.forSpace(workspace.activeSpace?.root ?? null)
  })

  const follows = (_value: unknown) => undefined

  $effect(() => {
    follows(suggestions)
    active = asking?.field === 'name' ? -1 : 0
  })

  const searchMark = $derived(search.asks ? workspace.bookmarks.forSearch(search.text) : null)

  const groups = $derived.by(() => {
    const out: { path: string; name: string; loose: boolean; archived: boolean; hits: Hit[] }[] = []

    for (const hit of search.hits) {
      const last = out.at(-1)
      if (last?.path === hit.path) last.hits.push(hit)
      else {
        out.push({
          path: hit.path,
          name: hit.name,
          loose: hit.score !== undefined,
          archived: search.archived && workspace.archive.has(hit.path),
          hits: [hit],
        })
      }
    }

    return [...out.filter((group) => !group.archived), ...out.filter((group) => group.archived)]
  })

  function pieces(text: string, ranges: Range[]) {
    const out: { text: string; mark: boolean }[] = []
    let at = 0

    for (const range of ranges) {
      if (range.from > at) out.push({ text: text.slice(at, range.from), mark: false })
      out.push({ text: text.slice(range.from, range.to), mark: true })
      at = range.to
    }

    if (at < text.length) out.push({ text: text.slice(at), mark: false })
    return out
  }

  function typing(event: Event & { currentTarget: HTMLInputElement }) {
    caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    shut = false
    search.ask(event.currentTarget.value)
  }

  function take(value: string) {
    if (!asking) return

    const next = chosen(search.text, asking, value)
    search.ask(next.text)
    caret = next.caret

    queueMicrotask(() => {
      field?.focus()
      field?.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeydown(event: KeyboardEvent) {
    if (suggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        active = (active + 1) % suggestions.length
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        active = (active + suggestions.length - 1) % suggestions.length
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const value = suggestions[active]
        if (value !== undefined) {
          event.preventDefault()
          take(value)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        shut = true
        return
      }
    }

    if (event.key === 'Escape' && search.replacing) {
      event.preventDefault()
      search.closeReplace()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (search.text) search.ask('')
      else workspace.showPanel('tree')
    }
  }

  function shown(hit: Hit, task: { text: string; ranges: Range[] } | null) {
    return task ? pieces(task.text, task.ranges) : pieces(hit.text, hit.ranges)
  }

  function ticked(event: Event, hit: Hit) {
    event.preventDefault()
    event.stopPropagation()
    void workspace.toggleTaskAt(hit.path, hit.line).then((done) => {
      if (done) search.ask(search.text)
    })
  }

  async function openHit(hit: Hit, press: MouseEvent) {
    const ask = tabAsk(press)
    const how = howFor(ask)

    if (hit.page !== undefined) {
      await workspace.openPdf(hit.path, hit.page, how)
      return
    }
    if (hit.tab !== undefined) {
      workspace.activate(hit.tab)
      ongoto?.(hit.line)
      return
    }

    if (isScratchpad(hit.path)) {
      const { scratchpad } = await import('./scratchpad/pad')
      scratchpad.show(hit.line)
      return
    }

    await workspace.open(hit.path, how)
    if (ask !== 'behind') ongoto?.(hit.line)
  }
</script>

<div class="find" data-search={warm.said}>
  <div class="row">
    <div class="box">
      <svg class="orden-field-mark mag" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>

      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={field}
        class="orden-field query"
        class:wide={search.asks}
        value={search.text}
        oninput={typing}
        onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onclick={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onkeydown={onKeydown}
        placeholder={focused && !search.text
          ? 'path: tag: file: -word "…" /re/'
          : 'Search this space'}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        role="combobox"
        aria-label="Search this space"
        aria-expanded={suggestions.length > 0}
        aria-controls="orden-search-values"
        aria-activedescendant={suggestions.length ? `orden-search-values-${active}` : undefined}
        autofocus
      />

      {#if search.asks && search.hits.length}
        <span class="found" transition:fly={{ x: 6, duration: dur(130), easing: cubicOut }}>
          {search.hits.length}
        </span>
      {/if}

      {#if searchMark}
        {@const kept = workspace.bookmarks.has(searchMark)}
        <button
          class="star"
          class:on={kept}
          title={kept ? 'Remove from Essentials' : 'Add to Essentials'}
          aria-label={kept ? 'Remove from Essentials' : 'Add to Essentials'}
          aria-pressed={kept}
          onclick={() => workspace.bookmarks.toggle(searchMark)}
          transition:fly={{ x: 6, duration: dur(130), easing: cubicOut }}
        >
          <svg viewBox="0 0 13 13"><path d={STAR} /></svg>
        </button>
      {/if}

      {#if suggestions.length}
        <Suggest
          id="orden-search-values"
          label="Values"
          values={suggestions}
          typed={asking?.typed ?? ''}
          {active}
          onchoose={take}
        />
      {/if}
    </div>

    {#if writable}
      <button
        class="swap"
        class:active={search.replacing}
        title="Replace"
        aria-label="Replace"
        aria-pressed={search.replacing}
        onclick={() => search.toggleReplace()}
      >
        <svg viewBox="0 0 13 13"><path d={SWAP} /></svg>
      </button>
    {/if}

    {#if workspace.archive.any || search.archived}
      <button
        class="swap"
        class:active={search.archived}
        title="Archived"
        aria-label="Archived"
        aria-pressed={search.archived}
        onclick={() => search.showArchived(!search.archived)}
      >
        <svg viewBox="0 0 13 13"><path d={ARCHIVE_MARK} /></svg>
      </button>
    {/if}
  </div>

  {#if search.replacing && writable}
    <div class="row" transition:fly={{ y: -6, duration: dur(130), easing: cubicOut }}>
      <input
        class="orden-field query"
        value={search.replacement}
        oninput={(event) => (search.replacement = event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Escape') search.closeReplace()
          if (event.key === 'Enter') void search.replace()
        }}
        placeholder="Replace with"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
      />

      <button class="apply" disabled={!search.chosen.length} onclick={() => void search.replace()}>
        Replace<span class="count">{search.chosen.length}</span>
      </button>
    </div>
  {/if}
</div>

{#if groups.length}
  <ul
    use:roving={{
      rows: '.hit',
      open: (row) => row.click(),
      peek: (row) => {
        row.click()
        row.focus()
      },
    }}
  >
    {#each groups as group, index (`${group.path}:${index}`)}
      <li class="group">
        <div class="orden-section note">
          {#if group.loose}<span class="guess" title="Close match">~</span
            >{/if}{#if group.archived}<svg
              class="archived"
              viewBox="0 0 13 13"
              aria-label="Archived"><path d={ARCHIVE_MARK} /></svg
            >{/if}{shownName(group.name)}
        </div>

        {#each group.hits as hit (hit.line)}
          {@const task = hit.tab === undefined ? taskOf(hit) : null}
          <div class="line">
            {#if search.replacing && hit.tab === undefined && !hit.bare}
              <button
                class="tick"
                class:on={search.keeps(hit)}
                role="checkbox"
                aria-checked={search.keeps(hit)}
                aria-label={hit.text}
                onclick={() => search.toggle(hit)}
              >
                <svg viewBox="0 0 13 13"><path d={TICK} /></svg>
              </button>
            {/if}

            {#if task}
              <input
                type="checkbox"
                class="orden-checkbox"
                checked={task.done}
                aria-label={task.text}
                onclick={(event) => ticked(event, hit)}
              />
            {/if}
            <button
              class="orden-row is-short hit"
              onclick={(event) => void openHit(hit, event)}
              use:middleOpens={(event) => void openHit(hit, event)}
            >
              {#each shown(hit, task) as piece, at (at)}
                {#if piece.mark}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
              {/each}

              {#if hit.page !== undefined}
                <span class="orden-row-meta">Page {hit.page}</span>
              {/if}
            </button>
          </div>
        {/each}
      </li>
    {/each}
  </ul>
{:else if search.asks && !search.running}
  <p class="empty-text">Nothing found</p>
{:else if !search.text.trim() && tags.length}
  <TagTree nodes={tags} />
{/if}

<style>
  .find {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  .box {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .query {
    padding-inline-start: calc(var(--row-pad) + var(--icon-md) + var(--row-gap));
    transition: padding-inline-end var(--dur-fast) var(--ease-out);
  }

  .query.wide {
    padding-inline-end: 56px;
  }

  .mag {
    position: absolute;
    inset-inline-start: var(--row-pad);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .found {
    position: absolute;
    top: 50%;
    inset-inline-end: 32px;
    transform: translateY(-50%);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .star {
    position: absolute;
    top: 50%;
    inset-inline-end: 5px;
    transform: translateY(-50%);
    width: calc(var(--row-height) - 6px);
    height: calc(var(--row-height) - 6px);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .star:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .star:active {
    transform: translateY(-50%) scale(0.88);
  }

  .star.on {
    color: var(--accent);
  }

  .star.on svg {
    fill: currentColor;
  }

  .star:focus-visible {
    outline-offset: -1px;
  }

  .swap {
    flex: none;
    width: var(--row-height);
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .swap:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .swap:active {
    background: var(--surface-press);
  }

  .swap.active {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .swap:focus-visible {
    outline-offset: -1px;
  }

  .apply {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-height: var(--row-height);
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .apply:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .apply:active:not(:disabled) {
    background: var(--accent-press);
  }

  .apply .count {
    color: inherit;
    opacity: 0.75;
  }

  .apply:focus-visible {
    outline-offset: 1px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .group + .group {
    margin-top: var(--space-2);
  }

  .note {
    display: block;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guess {
    margin-inline-end: 3px;
    color: var(--muted);
  }

  svg.archived {
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-inline-end: var(--space-1);
    vertical-align: -2px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .line > .orden-checkbox {
    flex: none;
    margin-block: 0;
    margin-inline: var(--row-pad) 0;
  }

  .hit {
    flex: 1;
    min-width: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: var(--row-height-sm);
  }

  mark {
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .tick {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    display: grid;
    place-items: center;
    margin-inline-start: 4px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: none;
    color: transparent;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .tick:hover {
    border-color: var(--accent-line);
  }

  .tick:active {
    transform: scale(0.86);
  }

  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }

  .tick:focus-visible {
    outline-offset: 1px;
  }

  .tick svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .empty-text {
    margin: var(--space-3) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  :global([data-touch]) .query.wide {
    padding-inline-end: 68px;
  }

  :global([data-touch]) .swap,
  :global([data-touch]) .apply {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .swap {
    width: var(--touch-target);
  }

  :global([data-touch]) .empty-text {
    font-size: var(--touch-text);
  }
</style>
