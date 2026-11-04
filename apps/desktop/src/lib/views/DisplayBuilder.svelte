<script lang="ts">
  /** Todoist's Display menu (#1046), in the view's head where a view is of tasks: the
   *  layout (list, board, calendar), whether done tasks stay, then Sort - how it is
   *  grouped and how it is sorted - and Filter - a priority, a label, when it was written
   *  down, who it is assigned to - each folded away with a count of what differs from
   *  the view as it came, a dot beside each such row, and Reset all at the foot
   *  (display.ts). Every choice is a change of the view, kept where the view keeps its
   *  changes: a space's Todos in that space, a project here, a base in its file. */
  import Hint from '../Hint.svelte'
  import { t } from '../i18n.svelte'
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
    groupingsFor,
    type Only,
    notesIn,
    onlyOf,
    shippedGrouping,
    shippedSorting,
    type Sorting,
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
  import { switched } from './layout'
  import { LAYOUT_MARKS } from './marks'
  import { shippedBase } from './source'
  import { labelsOf } from './task-meta'
  import { type Layout, layoutName, layoutOf } from './words'

  const { kit, onreset }: { kit: Kit; onreset?: (() => void) | undefined } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  /** The view as it came, for a view Orden ships: what each row's default is. */
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
  const project = $derived(kit.spec.builtin === 'project')
  /** The projects a view of more than one can be narrowed to: not a project's own. */
  const notes = $derived(project ? [] : notesIn(live.rows))
  const assignees = $derived(assigneesOf(live.rows))
  /** Who a task is assigned to is a question in a space shared with others. */
  const shared = $derived(assignees.length > 0 || live.rows.some((one) => one.file.shared))
  const changed = $derived(view ? changedFrom(view, original) : { sort: 0, filter: 0, total: 0 })

  /** The grouping and the sorting as the menu names them: the view's own as it came
   *  under the name of what it is, where it has one. */
  const groupingShown = $derived(grouping === 'default' ? shippedGrouping(original) : grouping)
  const sortingShown = $derived(
    sorting.sorting === 'default' ? shippedSorting(original) : sorting.sorting,
  )
  const groupingSet = $derived(original !== null && groupingShown !== shippedGrouping(original))
  const sortingSet = $derived(original !== null && sortingShown !== shippedSorting(original))

  const groupings = $derived.by(() => {
    const offered: Grouping[] = groupingsFor(project)
    // What the view is grouped by now is always a choice, whatever it is.
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
    default: t('Default'),
    none: t('None'),
    note: t('Project'),
    section: t('Section'),
    date: t('Start date'),
    deadline: t('Deadline'),
    priority: t('Priority'),
    tag: t('Label'),
    due: t('Date'),
    status: t('Status'),
  }
  const SORT_NAMES: Record<Sorting, string> = {
    default: t('Default'),
    smart: t('Smart'),
    manual: t('Manual'),
    name: t('Name'),
    date: t('Start date'),
    deadline: t('Deadline'),
    priority: t('Priority'),
    note: t('Note'),
    created: t('Created'),
  }
  const ANY = ''

  function group(next: string) {
    const chosen = GROUPINGS.find((one) => one === next)
    if (!chosen) return
    // The view's own grouping, chosen again, is the view as it came, its order and all.
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

  /** The view narrowed by one choice more, or by one less where All was chosen. */
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
    if (change.project !== undefined) {
      if (change.project === ANY) delete next.project
      else next.project = change.project
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
    kit.change((base, at) => withOnly(base, at, next))
  }

  /** Everything back as the view came: a view Orden ships as it shipped, a base's
   *  narrowing and its done tasks as a plain list has them. */
  function resetAll() {
    if (onreset) {
      onreset()
      return
    }
    kit.change((base, at) => withCompleted(withOnly(base, at, {}), at, false))
  }
</script>

{#snippet dot(on: boolean)}
  {#if on}<span class="dot" aria-label={t('Changed')}></span>{/if}
{/snippet}

{#snippet fold(name: string, count: number, open: boolean, toggle: () => void)}
  <button type="button" class="fold" aria-expanded={open} onclick={toggle}>
    <span class="twist"><Twist {open} /></span>
    <span class="nib-section">{name}</span>
    {#if count}<span class="badge">{count}</span>{/if}
  </button>
{/snippet}

<div class="display">
  <div class="top">
    <div class="nib-segmented" role="radiogroup" aria-label={t('Layout')} use:segmented>
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
      text={t(
        'Layout shows the tasks as a list, a board or a calendar. Grouping splits them into groups, which are the columns of a board. Sorting orders each group. Filters hide what you do not need. All of it is kept for this view.',
      )}
    />
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

  {@render fold(t('Sort'), changed.sort, sortOpen, () => (sortOpen = !sortOpen))}
  {#if sortOpen}
    <div class="pair">
      <span class="name">{t('Grouping')}{@render dot(groupingSet)}</span>
      <Select
        label={t('Grouping')}
        value={groupingShown}
        options={groupings.map((one) => ({ value: one, label: GROUP_NAMES[one] }))}
        onchange={group}
      />
    </div>
    <div class="pair">
      <span class="name">{t('Sorting')}{@render dot(sortingSet)}</span>
      <Select
        label={t('Sorting')}
        value={sortingShown}
        options={sortings.map((one) => ({ value: one, label: SORT_NAMES[one] }))}
        onchange={sort}
      />
      {#if sortingShown !== 'smart' && sortingShown !== 'manual' && sortingShown !== 'default'}
        <button
          type="button"
          class="nib-glyph"
          aria-label={sorting.down ? t('Descending') : t('Ascending')}
          title={sorting.down ? t('Descending') : t('Ascending')}
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

  {@render fold(t('Filter'), changed.filter, filterOpen, () => (filterOpen = !filterOpen))}
  {#if filterOpen}
    {#if notes.length > 1 || only.project !== undefined}
      <div class="pair">
        <span class="name">{t('Project')}{@render dot(only.project !== undefined)}</span>
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
      <span class="name">{t('Priority')}{@render dot(only.priority !== undefined)}</span>
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
    {#if labels.length || only.label !== undefined}
      <div class="pair">
        <span class="name">{t('Label')}{@render dot(only.label !== undefined)}</span>
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
    <!-- Todos' grouping already says when each task is due; another view of tasks can be
         narrowed to a day. -->
    {#if kit.spec.builtin !== 'todos' || only.date !== undefined}
      <div class="pair">
        <span class="name">{t('Date')}{@render dot(only.date !== undefined)}</span>
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
    {/if}
    <div class="pair">
      <span class="name">{t('Created')}{@render dot(only.created !== undefined)}</span>
      <Select
        label={t('Created')}
        value={only.created ?? ANY}
        options={[
          { value: ANY, label: t('All') },
          { value: 'today', label: t('Today') },
          { value: 'week', label: t('Last 7 days') },
          { value: 'month', label: t('Last 30 days') },
        ]}
        onchange={(next: string) => narrow({ created: next })}
      />
    </div>
    {#if shared || only.assignee !== undefined}
      <div class="pair">
        <span class="name">{t('Assignee')}{@render dot(only.assignee !== undefined)}</span>
        <Select
          label={t('Assignee')}
          value={only.assignee ?? ANY}
          options={[
            { value: ANY, label: t('All') },
            { value: ASSIGNED_TO_ME, label: t('Assigned to me') },
            { value: UNASSIGNED, label: t('Unassigned') },
            ...assignees.map((name) => ({ value: name, label: name })),
          ]}
          onchange={(next: string) => narrow({ assignee: next })}
        />
      </div>
    {/if}
  {/if}

  <button
    type="button"
    class="nib-chip is-quiet reset"
    disabled={changed.total === 0}
    onclick={resetAll}>{t('Reset all')}</button
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

  .fold .nib-section {
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
