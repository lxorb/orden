<script lang="ts">
  import Hint from '../Hint.svelte'
  import Select from '../Select.svelte'
  import { segmented } from '../slide'
  import Twist from '../Twist.svelte'
  import {
    ASSIGNED_TO_ME,
    assigneesOf,
    changedFrom,
    type Grouping,
    GROUPINGS,
    groupingOf,
    GROUPS_OFFERED,
    type Only,
    onlyOf,
    shippedGrouping,
    shippedSorting,
    type Sorting,
    spacesIn,
    sortingOf,
    SORTINGS,
    SORTS_OFFERED,
    UNASSIGNED,
    withCompleted,
    withGrouping,
    withOnly,
    withSorting,
  } from './display'
  import type { Kit } from './kit'
  import { workspace } from '../workspace.svelte'
  import { switched } from './layout'
  import { LAYOUT_MARKS } from './marks'
  import { shippedBase } from './source'
  import { labelsOf } from './task-meta'
  import { type Layout, layoutName, layoutOf } from './words'

  const { kit, onreset }: { kit: Kit; onreset?: (() => void) | undefined } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const original = $derived.by(() => {
    if (kit.spec.builtin === undefined) return null
    return shippedBase(kit.spec).views[0] ?? null
  })

  const LAYOUTS: readonly Layout[] = ['list', 'kanban', 'calendar']
  const layout = $derived(layoutOf(view?.type ?? 'list'))
  const grouping = $derived(view ? groupingOf(view, original) : 'none')
  const UNSORTED: { sorting: Sorting; down: boolean } = { sorting: 'manual', down: false }
  const sorting = $derived(view ? sortingOf(view, original) : UNSORTED)
  const only = $derived(view ? onlyOf(view) : {})
  const labels = $derived(labelsOf(live.rows))
  const assignees = $derived(assigneesOf(live.rows))
  const spaces = $derived(
    kit.spec.space === undefined
      ? spacesIn(
          live.rows,
          workspace.shownSpaces.map((one) => one.name),
        )
      : [],
  )
  const shared = $derived(assignees.length > 0 || live.rows.some((one) => one.file.shared))
  const changed = $derived(view ? changedFrom(view, original) : { sort: 0, filter: 0, total: 0 })

  const groupingShown = $derived(grouping === 'default' ? shippedGrouping(original) : grouping)
  const sortingShown = $derived(
    sorting.sorting === 'default' ? shippedSorting(original) : sorting.sorting,
  )
  const groupingSet = $derived(original !== null && groupingShown !== shippedGrouping(original))
  const sortingSet = $derived(original !== null && sortingShown !== shippedSorting(original))

  const groupings = $derived.by(() => {
    const offered: Grouping[] = [...GROUPS_OFFERED]
    if (!offered.includes(groupingShown)) offered.push(groupingShown)
    return offered
  })
  const sortings = $derived.by(() => {
    const offered: Sorting[] = [...SORTS_OFFERED]
    if (!offered.includes(sortingShown)) offered.push(sortingShown)
    return offered
  })

  let sortOpen = $state(true)
  let filterOpen = $state(false)

  const GROUP_NAMES: Record<Grouping, string> = {
    default: 'Default',
    none: 'None',
    date: 'Start date',
    deadline: 'Deadline',
    priority: 'Priority',
    tag: 'Label',
    due: 'Date',
    status: 'Status',
  }
  const SORT_NAMES: Record<Sorting, string> = {
    default: 'Default',
    smart: 'Smart',
    manual: 'Manual',
    name: 'Name',
    date: 'Start date',
    deadline: 'Deadline',
    priority: 'Priority',
    created: 'Created',
  }
  const ANY = ''

  function group(next: string) {
    const chosen = GROUPINGS.find((one) => one === next)
    if (!chosen) return
    const back = chosen === shippedGrouping(original) && original !== null
    kit.change((base, at) => withGrouping(base, at, back ? 'default' : chosen, original))
  }

  function sort(next: string) {
    const chosen = SORTINGS.find((one) => one === next)
    if (!chosen) return
    const back = chosen === shippedSorting(original) && original !== null
    kit.change((base, at) =>
      withSorting(base, at, back ? 'default' : chosen, back ? false : sorting.down, original),
    )
  }

  function narrow(change: Partial<Record<keyof Only, string>>) {
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
    if (change.created !== undefined) {
      const when = change.created
      if (when === 'today' || when === 'week' || when === 'month') next.created = when
      else delete next.created
    }
    if (change.assignee !== undefined) {
      if (change.assignee === ANY) delete next.assignee
      else next.assignee = change.assignee
    }
    if (change.space !== undefined) {
      if (change.space === ANY) delete next.space
      else next.space = change.space
    }
    kit.change((base, at) => withOnly(base, at, next))
  }

  function resetAll() {
    if (onreset) {
      onreset()
      return
    }
    kit.change((base, at) => withCompleted(withOnly(base, at, {}), at, false))
  }
</script>

{#snippet dot(on: boolean)}
  {#if on}<span class="dot" aria-label="Changed"></span>{/if}
{/snippet}

{#snippet fold(name: string, count: number, open: boolean, toggle: () => void)}
  <button type="button" class="fold" aria-expanded={open} onclick={toggle}>
    <span class="twist"><Twist {open} /></span>
    <span class="orden-section">{name}</span>
    {#if count}<span class="badge">{count}</span>{/if}
  </button>
{/snippet}

<div class="display">
  <div class="top">
    <div class="orden-segmented" role="radiogroup" aria-label="Layout" use:segmented>
      {#each LAYOUTS as one (one)}
        <button
          type="button"
          role="radio"
          aria-checked={layout === one}
          class:on={layout === one}
          onclick={() => kit.change((base, at) => switched(base, at, one, live.rows))}
          ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={LAYOUT_MARKS[one]} /></svg
          >{layoutName(one)}</button
        >
      {/each}
    </div>
    <Hint
      text="Layout shows the tasks as a list, a board or a calendar. Grouping splits them into groups, which are the columns of a board. Sorting orders each group. Filters hide what you do not need. All of it is kept for this view."
    />
  </div>

  <div
    class="orden-setting pressable"
    role="switch"
    tabindex="0"
    aria-checked={view?.orden.showCompleted === true}
    onclick={() => kit.change((base, at) => withCompleted(base, at, !view?.orden.showCompleted))}
    onkeydown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      kit.change((base, at) => withCompleted(base, at, !view?.orden.showCompleted))
    }}
  >
    <span class="name">Completed tasks</span>
    <span class="orden-switch" class:on={view?.orden.showCompleted === true} aria-hidden="true"
    ></span>
  </div>

  {@render fold('Sort', changed.sort, sortOpen, () => (sortOpen = !sortOpen))}
  {#if sortOpen}
    <div class="pair">
      <span class="name">Grouping{@render dot(groupingSet)}</span>
      <Select
        label="Grouping"
        value={groupingShown}
        options={groupings.map((one) => ({ value: one, label: GROUP_NAMES[one] }))}
        onchange={group}
      />
    </div>
    <div class="pair">
      <span class="name">Sorting{@render dot(sortingSet)}</span>
      <Select
        label="Sorting"
        value={sortingShown}
        options={sortings.map((one) => ({ value: one, label: SORT_NAMES[one] }))}
        onchange={sort}
      />
      {#if sortingShown !== 'smart' && sortingShown !== 'manual' && sortingShown !== 'default'}
        <button
          type="button"
          class="orden-glyph"
          aria-label={sorting.down ? 'Descending' : 'Ascending'}
          title={sorting.down ? 'Descending' : 'Ascending'}
          onclick={() =>
            kit.change((base, at) => withSorting(base, at, sortingShown, !sorting.down, original))}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true" class="arrow" class:down={sorting.down}
            ><path d="M6.5 2v9M3.5 5l3-3 3 3" /></svg
          >
        </button>
      {/if}
    </div>
  {/if}

  {@render fold('Filter', changed.filter, filterOpen, () => (filterOpen = !filterOpen))}
  {#if filterOpen}
    {#if spaces.length > 1 || only.space !== undefined}
      <div class="pair">
        <span class="name">Space{@render dot(only.space !== undefined)}</span>
        <Select
          label="Space"
          value={only.space ?? ANY}
          options={[
            { value: ANY, label: 'All' },
            ...spaces.map((name) => ({ value: name, label: name })),
          ]}
          onchange={(next: string) => narrow({ space: next })}
        />
      </div>
    {/if}
    <div class="pair">
      <span class="name">Priority{@render dot(only.priority !== undefined)}</span>
      <Select
        label="Priority"
        value={only.priority === undefined ? ANY : String(only.priority)}
        options={[
          { value: ANY, label: 'All' },
          ...[1, 2, 3, 4].map((level) => ({ value: String(level), label: `p${level}` })),
        ]}
        onchange={(next: string) => narrow({ priority: next })}
      />
    </div>
    {#if labels.length || only.label !== undefined}
      <div class="pair">
        <span class="name">Label{@render dot(only.label !== undefined)}</span>
        <Select
          label="Label"
          value={only.label ?? ANY}
          options={[
            { value: ANY, label: 'All' },
            ...labels.map((tag) => ({ value: tag, label: `#${tag}` })),
          ]}
          onchange={(next: string) => narrow({ label: next })}
        />
      </div>
    {/if}
    {#if kit.spec.builtin !== 'todos' || only.date !== undefined}
      <div class="pair">
        <span class="name">Date{@render dot(only.date !== undefined)}</span>
        <Select
          label="Date"
          value={only.date ?? ANY}
          options={[
            { value: ANY, label: 'All' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'none', label: 'No date' },
          ]}
          onchange={(next: string) => narrow({ date: next })}
        />
      </div>
    {/if}
    <div class="pair">
      <span class="name">Created{@render dot(only.created !== undefined)}</span>
      <Select
        label="Created"
        value={only.created ?? ANY}
        options={[
          { value: ANY, label: 'All' },
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Last 7 days' },
          { value: 'month', label: 'Last 30 days' },
        ]}
        onchange={(next: string) => narrow({ created: next })}
      />
    </div>
    {#if shared || only.assignee !== undefined}
      <div class="pair">
        <span class="name">Assignee{@render dot(only.assignee !== undefined)}</span>
        <Select
          label="Assignee"
          value={only.assignee ?? ANY}
          options={[
            { value: ANY, label: 'All' },
            { value: ASSIGNED_TO_ME, label: 'Assigned to me' },
            { value: UNASSIGNED, label: 'Unassigned' },
            ...assignees.map((name) => ({ value: name, label: name })),
          ]}
          onchange={(next: string) => narrow({ assignee: next })}
        />
      </div>
    {/if}
  {/if}

  <button
    type="button"
    class="orden-chip is-quiet reset"
    disabled={changed.total === 0}
    onclick={resetAll}>Reset all</button
  >
</div>

<style>
  .display {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 17rem;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .top > :first-child {
    flex: 1;
  }

  .pressable {
    cursor: default;
  }

  .name {
    flex: 1;
    display: inline-flex;
    justify-content: flex-start;
    text-align: start;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .pair {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }

  .fold .orden-section {
    margin: 0;
  }

  .twist {
    display: grid;
    width: 10px;
    height: 10px;
    color: var(--muted);
  }

  .badge {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    text-align: center;
  }

  .arrow {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: rotate var(--dur-fast) var(--ease-out);
  }

  .arrow.down {
    rotate: 180deg;
  }

  .reset {
    align-self: flex-start;
    margin-top: var(--space-1);
  }
</style>
