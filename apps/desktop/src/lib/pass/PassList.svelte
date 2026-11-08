<script lang="ts">
  import { keyElsewhere } from '../layer-keys'
  import { blank } from '@orden/pass/envelope'
  import type { Item } from '@orden/pass/types'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowUpDown from 'lucide/dist/esm/icons/arrow-up-down.mjs'
  import ListChecks from 'lucide/dist/esm/icons/list-checks.mjs'
  import ListFilter from 'lucide/dist/esm/icons/list-filter.mjs'
  import Menu from 'lucide/dist/esm/icons/menu.mjs'
  import Search from 'lucide/dist/esm/icons/search.mjs'
  import { plural, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { prompt } from '../prompt.svelte'
  import Glyph from './Glyph.svelte'
  import DeletedElsewhere from './DeletedElsewhere.svelte'
  import InvitesList from './InvitesList.svelte'
  import ItemMark from './ItemMark.svelte'
  import { listed, SORTS, subtitleOf, TYPE_FILTERS } from './list'
  import { filterName, scopeName, sortName } from './scope-words'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'

  const {
    ui,
    stepped = false,
    heading = null,
    onside = null,
  }: {
    ui: PassUi
    stepped?: boolean
    heading?: { title: string; ids: readonly string[]; back: () => void } | null
    onside?: (() => void) | null
  } = $props()

  const view = $derived(ui.view)
  const trash = $derived(view.scope.kind === 'trash' && heading === null)
  const source = $derived(
    heading === null ? pass.items : pass.items.filter((one) => heading.ids.includes(one.id)),
  )
  const shown = $derived(
    listed(
      source,
      pass.vaults,
      heading === null ? view.scope : { kind: 'all' },
      heading === null ? view.filter : 'all',
      view.sort,
      ui.query,
    ),
  )
  const rows = $derived(shown.rows)
  const pinned = $derived(ui.query.trim() === '' && heading === null ? shown.pinned : [])
  const title = $derived(heading?.title ?? scopeName(view.scope, pass.vaults))
  const picked = $derived(ui.picked)
  const pickedSet = $derived(new Set(picked ?? []))

  let list = $state<HTMLElement>()

  function showFilters(event: MouseEvent) {
    menu.show(
      event,
      TYPE_FILTERS.map((filter) => ({
        label: filterName(filter),
        hint: String(shown.counts[filter]),
        checked: view.filter === filter,
        run: () => ui.show({ filter }),
      })),
      { until: pass.opened },
    )
  }

  function showSorts(event: MouseEvent) {
    menu.show(
      event,
      SORTS.map((sort) => ({
        label: sortName(sort),
        checked: view.sort === sort,
        run: () => ui.show({ sort }),
      })),
      { until: pass.opened },
    )
  }

  function pressed(item: Item) {
    if (picked !== null) {
      ui.picked = pickedSet.has(item.id)
        ? picked.filter((one) => one !== item.id)
        : [...picked, item.id]
      return
    }
    void ui.openItem(item.id)
  }

  function stepTo(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (keyElsewhere(event, event.currentTarget)) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!rows.length) return
    event.preventDefault()
    const at = rows.findIndex((one) => one.id === view.item)
    const next =
      at < 0
        ? event.key === 'ArrowDown'
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))
    const item = rows[next]
    if (!item) return
    void ui.openItem(item.id).then(() => {
      list?.querySelector<HTMLElement>(`[data-item="${item.id}"]`)?.focus()
    })
  }

  async function emptyTrash() {
    const sure = await prompt.confirm({
      until: pass.opened,
      title: t('Empty the trash?'),
      detail: t('Everything in the trash is deleted for good.'),
      confirmLabel: t('Empty trash'),
      danger: true,
    })
    if (sure) await pass.emptyTrash()
  }

  async function removePicked(ids: string[]) {
    const sure = await prompt.confirm({
      until: pass.opened,
      title: plural(ids.length, {
        one: 'Delete {count} item for good?',
        other: 'Delete {count} items for good?',
      }),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!sure) return
    await pass.remove(ids)
    ui.picked = null
  }

  async function trashPicked(ids: string[]) {
    await pass.trash(ids)
    ui.picked = null
  }

  async function restorePicked(ids: string[]) {
    await pass.restore(ids)
    ui.picked = null
  }
</script>

<section class="list" aria-label={title}>
  <header class="head">
    {#if heading}
      <button
        class="orden-glyph"
        type="button"
        aria-label={t('Back')}
        title={t('Back')}
        onclick={heading.back}
      >
        <Glyph icon={ArrowLeft} />
      </button>
    {:else if stepped}
      <button
        class="orden-glyph"
        type="button"
        aria-label={t('Back')}
        title={t('Back')}
        onclick={() => ui.back()}
      >
        <Glyph icon={ArrowLeft} />
      </button>
    {:else if onside}
      <button
        class="orden-glyph"
        type="button"
        aria-label={t('Vaults')}
        title={t('Vaults')}
        onclick={onside}
      >
        <Glyph icon={Menu} />
      </button>
    {/if}
    <label class="orden-field search">
      <Glyph icon={Search} class="orden-field-mark" />
      <input
        type="search"
        bind:this={ui.searchField}
        bind:value={ui.query}
        placeholder={t('Search in {place}', { place: title })}
        aria-label={t('Search')}
        onkeydown={(event) => {
          if (event.key === 'Escape' && ui.query) {
            event.preventDefault()
            ui.query = ''
          } else if (event.key === 'ArrowDown') {
            stepTo(event)
          }
        }}
      />
    </label>
  </header>

  {#if picked !== null}
    <div class="bar picking" role="toolbar" aria-label={t('Selected items')}>
      <span class="count"
        >{plural(picked.length, { one: '{count} selected', other: '{count} selected' })}</span
      >
      {#if trash}
        <button
          class="orden-button is-quiet"
          type="button"
          disabled={!picked.length}
          onclick={() => void restorePicked(picked)}>{t('Restore')}</button
        >
        <button
          class="orden-button is-quiet danger"
          type="button"
          disabled={!picked.length}
          onclick={() => void removePicked(picked)}>{t('Delete')}</button
        >
      {:else}
        <button
          class="orden-button is-quiet"
          type="button"
          disabled={!picked.length}
          onclick={() => (ui.sheet = { kind: 'move', ids: picked })}>{t('Move')}</button
        >
        <button
          class="orden-button is-quiet danger"
          type="button"
          disabled={!picked.length}
          onclick={() => void trashPicked(picked)}>{t('Trash')}</button
        >
      {/if}
      <button class="orden-button is-quiet is-soft" type="button" onclick={() => (ui.picked = null)}
        >{t('Done')}</button
      >
    </div>
  {:else}
    <div class="bar">
      {#if heading === null}
        <button class="orden-chip is-quiet is-shrinkable" type="button" onclick={showFilters}>
          <span class="chip-words">
            <Glyph icon={ListFilter} />
            <span class="chip-name">{filterName(view.filter)}</span>
            <span class="number">{shown.counts[view.filter]}</span>
          </span>
        </button>
      {/if}
      <button class="orden-chip is-quiet is-shrinkable" type="button" onclick={showSorts}>
        <span class="chip-words">
          <Glyph icon={ArrowUpDown} />
          <span class="chip-name">{sortName(view.sort)}</span>
        </span>
      </button>
      <span class="gap"></span>
      {#if trash && rows.length}
        <button
          class="orden-chip is-quiet is-shrinkable danger"
          type="button"
          onclick={() => void emptyTrash()}>{t('Empty trash')}</button
        >
      {/if}
      {#if rows.length && heading === null}
        <button
          class="orden-glyph"
          type="button"
          aria-label={t('Select items')}
          title={t('Select items')}
          onclick={() => (ui.picked = [])}
        >
          <Glyph icon={ListChecks} />
        </button>
      {/if}
    </div>
  {/if}

  {#if view.scope.kind === 'shared-with-me' && heading === null}
    <InvitesList />
  {/if}

  {#if pinned.length}
    <div class="pinned" role="list" aria-label={t('Pinned')}>
      {#each pinned as item (item.id)}
        <button
          class="pin"
          class:is-on={view.item === item.id}
          type="button"
          role="listitem"
          onclick={() => void ui.openItem(item.id)}
        >
          <ItemMark content={item.content} />
          <span class="pin-name">{item.content.title || t('Untitled')}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="rows" role="list" bind:this={list} onkeydown={stepTo} data-scrolls>
    {#each rows as item (item.id)}
      <button
        class="orden-row item"
        class:is-on={view.item === item.id && picked === null}
        class:is-picked={pickedSet.has(item.id)}
        type="button"
        role="listitem"
        data-item={item.id}
        aria-current={view.item === item.id ? 'true' : undefined}
        onclick={() => pressed(item)}
      >
        {#if picked !== null}
          <span class="tick" class:on={pickedSet.has(item.id)} aria-hidden="true"></span>
        {/if}
        <ItemMark content={item.content} />
        <span class="orden-row-label">
          <span class="name">{item.content.title || t('Untitled')}</span>
          <span class="sub">{subtitleOf(item)}</span>
        </span>
      </button>
    {:else}
      <div class="empty">
        {#if ui.query.trim() !== ''}
          <p>{t('Nothing matches “{query}”', { query: ui.query.trim() })}</p>
        {:else if trash}
          <p>{t('The trash is empty')}</p>
        {:else if heading}
          <p>{t('Nothing here')}</p>
        {:else}
          <p>{t('Nothing here yet')}</p>
          <button class="orden-button" type="button" onclick={() => void ui.newItem(blank('login'))}
            >{t('New login')}</button
          >
        {/if}
      </div>
    {/each}
    {#if trash && ui.query.trim() === ''}<DeletedElsewhere />{/if}
  </div>
</section>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }

  .search {
    flex: 1;
    min-height: 34px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border-color: transparent;
  }

  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--row-height);
    padding: 0 var(--space-3) var(--space-2);
  }

  .bar.picking {
    flex-wrap: wrap;
  }

  .chip-words {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
  }

  .chip-name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .chip-words :global(.glyph) {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .number {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .gap {
    flex: 1;
  }

  .picking .count {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .danger {
    color: var(--danger);
  }

  .pinned {
    flex: none;
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding: 0 var(--space-3) var(--space-2);
    scrollbar-width: none;
  }

  .pinned::-webkit-scrollbar {
    display: none;
  }

  .pin {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 11rem;
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
    border: 1px solid var(--line);
    border-radius: 99px;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    --tile: 24px;
  }

  .pin :global(.item-mark) {
    --tile: 22px;
    border-radius: 50%;
  }

  .pin :global(.item-mark .glyph) {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .pin.is-on,
  .pin:hover {
    background: var(--surface-hover);
  }

  .pin-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-2) var(--space-3);
  }

  .item {
    min-height: 48px;
    gap: var(--space-3);
  }

  :global([data-touch]) .item {
    min-height: calc(var(--touch-row) + var(--space-2));
  }

  .item .orden-row-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .name,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    color: var(--text-strong);
  }

  .sub {
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    color: var(--muted);
  }

  .tick {
    flex: none;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--line-strong);
    border-radius: 5px;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: inset 0 0 0 2px var(--surface);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-7) var(--space-4);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }
</style>
