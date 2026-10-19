<script lang="ts">
  /** Todoist's Display menu, in the view's head where a view is of tasks: the layout
   *  (list, board, calendar), whether done tasks stay, how it is grouped and sorted, and
   *  what it is narrowed to - a priority, a label, a day (display.ts). Every choice is a
   *  change of the view, kept where the view keeps its changes; Reset puts a view nib
   *  ships back the way it came. */
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { segmented } from '../slide'
  import {
    type Grouping,
    GROUPINGS,
    groupingOf,
    type Only,
    notesIn,
    onlyOf,
    type Sorting,
    sortingOf,
    SORTINGS,
    withCompleted,
    withGrouping,
    withOnly,
    withSorting,
  } from './display'
  import type { Kit } from './kit'
  import { switched } from './layout'
  import { builtinBase } from './source'
  import { asShipped } from './spec'
  import { labelsOf } from './task-meta'
  import { type Layout, layoutName, layoutOf } from './words'

  const { kit, onreset }: { kit: Kit; onreset?: (() => void) | undefined } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  /** The view as it came, for a view nib ships: what Default means. */
  const original = $derived.by(() => {
    if (kit.spec.builtin === undefined) return null
    return builtinBase(asShipped(kit.spec)).views[0] ?? null
  })

  const LAYOUTS: readonly Layout[] = ['list', 'kanban', 'calendar']
  const layout = $derived(layoutOf(view?.type ?? 'list'))
  const grouping = $derived(view ? groupingOf(view, original) : 'none')
  const UNSORTED: { sorting: Sorting; down: boolean } = { sorting: 'manual', down: false }
  const sorting = $derived(view ? sortingOf(view, original) : UNSORTED)
  const only = $derived(view ? onlyOf(view) : {})
  const labels = $derived(labelsOf(live.rows))
  /** The projects a view of more than one can be narrowed to: not a project's own. */
  const notes = $derived(kit.spec.builtin === 'project' ? [] : notesIn(live.rows))

  const GROUP_NAMES: Record<Grouping, string> = {
    default: t('Default'),
    none: t('None'),
    note: t('Note'),
    section: t('Section'),
    date: t('Start date'),
    deadline: t('Deadline'),
    priority: t('Priority'),
  }
  const SORT_NAMES: Record<Sorting, string> = {
    default: t('Default'),
    manual: t('Manual'),
    name: t('Name'),
    date: t('Start date'),
    deadline: t('Deadline'),
    priority: t('Priority'),
    note: t('Note'),
  }
  const ANY = ''

  /** The view narrowed by one choice more, or by one less where All was chosen. */
  function narrow(change: { priority?: string; label?: string; date?: string; project?: string }) {
    const next: Only = { ...only }
    if (change.priority !== undefined) {
      const level = Number(change.priority)
      if (level === 1 || level === 2 || level === 3 || level === 4) next.priority = level
      else delete next.priority
    }
    if (change.label !== undefined) {
      if (change.label === ANY) delete next.label
      else next.label = change.label
    }
    if (change.date !== undefined) {
      const day = change.date
      if (day === 'overdue' || day === 'today' || day === 'week' || day === 'none') next.date = day
      else delete next.date
    }
    if (change.project !== undefined) {
      if (change.project === ANY) delete next.project
      else next.project = change.project
    }
    kit.change((base, at) => withOnly(base, at, next))
  }
</script>

<div class="display">
  <div class="nib-segmented" role="radiogroup" aria-label={t('Layout')} use:segmented>
    {#each LAYOUTS as one (one)}
      <button
        type="button"
        role="radio"
        aria-checked={layout === one}
        class:on={layout === one}
        onclick={() => kit.change((base, at) => switched(base, at, one, live.rows))}
        >{layoutName(one)}</button
      >
    {/each}
  </div>

  <div
    class="nib-setting pressable"
    role="switch"
    tabindex="0"
    aria-checked={view?.nib.showCompleted === true}
    onclick={() => kit.change((base, at) => withCompleted(base, at, !view?.nib.showCompleted))}
    onkeydown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      kit.change((base, at) => withCompleted(base, at, !view?.nib.showCompleted))
    }}
  >
    <span class="name">{t('Completed tasks')}</span>
    <span class="nib-switch" class:on={view?.nib.showCompleted === true} aria-hidden="true"></span>
  </div>

  <p class="nib-section">{t('Sort')}</p>
  <div class="pair">
    <span class="name">{t('Group')}</span>
    <Select
      label={t('Group')}
      value={grouping}
      options={GROUPINGS.filter((one) => one !== 'default' || original).map((one) => ({
        value: one,
        label: GROUP_NAMES[one],
      }))}
      onchange={(next: string) => {
        const chosen = GROUPINGS.find((one) => one === next)
        if (chosen) kit.change((base, at) => withGrouping(base, at, chosen, original))
      }}
    />
  </div>
  <div class="pair">
    <span class="name">{t('Sort')}</span>
    <Select
      label={t('Sort')}
      value={sorting.sorting}
      options={SORTINGS.filter((one) => one !== 'default' || original).map((one) => ({
        value: one,
        label: SORT_NAMES[one],
      }))}
      onchange={(next: string) => {
        const chosen = SORTINGS.find((one) => one === next)
        if (chosen) kit.change((base, at) => withSorting(base, at, chosen, sorting.down, original))
      }}
    />
    {#if sorting.sorting !== 'default' && sorting.sorting !== 'manual'}
      <button
        type="button"
        class="nib-glyph"
        aria-label={sorting.down ? t('Descending') : t('Ascending')}
        title={sorting.down ? t('Descending') : t('Ascending')}
        onclick={() =>
          kit.change((base, at) => withSorting(base, at, sorting.sorting, !sorting.down, original))}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true" class:down={sorting.down}
          ><path d="M6.5 2v9M3.5 5l3-3 3 3" /></svg
        >
      </button>
    {/if}
  </div>

  <p class="nib-section">{t('Filter')}</p>
  {#if notes.length > 1 || only.project !== undefined}
    <div class="pair">
      <span class="name">{t('Project')}</span>
      <Select
        label={t('Project')}
        value={only.project ?? ANY}
        options={[
          { value: ANY, label: t('All') },
          ...notes.map((one) => ({ value: one.path, label: one.name })),
        ]}
        onchange={(next: string) => narrow({ project: next })}
      />
    </div>
  {/if}
  <div class="pair">
    <span class="name">{t('Priority')}</span>
    <Select
      label={t('Priority')}
      value={only.priority === undefined ? ANY : String(only.priority)}
      options={[
        { value: ANY, label: t('All') },
        ...[1, 2, 3, 4].map((level) => ({ value: String(level), label: `p${level}` })),
      ]}
      onchange={(next: string) => narrow({ priority: next })}
    />
  </div>
  {#if labels.length}
    <div class="pair">
      <span class="name">{t('Label')}</span>
      <Select
        label={t('Label')}
        value={only.label ?? ANY}
        options={[
          { value: ANY, label: t('All') },
          ...labels.map((tag) => ({ value: tag, label: `#${tag}` })),
        ]}
        onchange={(next: string) => narrow({ label: next })}
      />
    </div>
  {/if}
  <div class="pair">
    <span class="name">{t('Date')}</span>
    <Select
      label={t('Date')}
      value={only.date ?? ANY}
      options={[
        { value: ANY, label: t('All') },
        { value: 'overdue', label: t('Overdue') },
        { value: 'today', label: t('Today') },
        { value: 'week', label: t('This week') },
        { value: 'none', label: t('No date') },
      ]}
      onchange={(next: string) => narrow({ date: next })}
    />
  </div>

  {#if onreset}
    <button type="button" class="nib-chip is-quiet reset" onclick={onreset}>{t('Reset')}</button>
  {/if}
</div>

<style>
  .display {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 17rem;
  }

  .display .nib-segmented {
    width: 100%;
  }

  .pressable {
    cursor: default;
  }

  .name {
    flex: 1;
    color: var(--text);
    font-size: var(--text-sm);
  }

  .pair {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .nib-section {
    margin: var(--space-2) 0 0;
  }

  svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: rotate var(--dur-fast) var(--ease-out);
  }

  svg.down {
    rotate: 180deg;
  }

  .reset {
    align-self: flex-start;
  }
</style>
