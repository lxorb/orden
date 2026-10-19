<script lang="ts">
  /** Upcoming as Todoist draws it: the month and a strip of the week across the top,
   *  each day with how many tasks it holds; then what is overdue, and every day from
   *  today down the page, an empty one too, each with its add row - as far as the list
   *  is scrolled, two years at most (docs/tasks.md 5.9). A task carried onto a day of
   *  the strip, or onto another day's group, is given that day; the arrows walk the
   *  strip a week at a time (Shift and an arrow too), Today comes back to today, and a day
   *  pressed is scrolled to wherever it is in the list.
   *
   *  As a board it is Todoist's too: a column for every day of the two weeks from the
   *  strip's first day, an empty one too, what is overdue first, a card carried to
   *  another column given that day; the arrows move the columns a week. */
  import { addDays, groupName } from '@nib/bases'
  import { untrack } from 'svelte'
  import { i18n, t } from '../i18n.svelte'
  import { dateAt } from './days'
  import { droppable } from './drag.svelte'
  import type { Kit } from './kit'
  import BoardLayout from './BoardLayout.svelte'
  import ListLayout from './ListLayout.svelte'
  import { dayCounts } from './calendar'
  import { shortcuts } from '../shortcuts.svelte'
  import './task-keys'

  const { kit, board = false }: { kit: Kit; board?: boolean } = $props()

  const live = $derived(kit.live)
  /** The first day the strip shows: today to begin with, since what is coming starts
   *  there. */
  let from = $state(untrack(() => kit.live.today))
  const week = $derived(Array.from({ length: 7 }, (_, step) => addDays(from, step)))
  const month = $derived(i18n.when(dateAt(from), { month: 'long', year: 'numeric' }))

  /** How many tasks each day of the answer holds. */
  const counts = $derived(dayCounts(live.answer?.groups ?? []))

  /** How far the days go: four weeks to begin with, and four more each time the end of
   *  the list comes into sight, never past two years. */
  let through = $state(untrack(() => addDays(kit.live.today, 27)))
  const furthest = $derived(addDays(live.today, 730))
  function further() {
    if (through < furthest) through = addDays(through, 28)
  }

  /** The day a press on the strip asked to see, and how many times. */
  let revealing = $state({ id: '', asked: 0 })

  function show(day: string) {
    if (day > through) through = day > furthest ? furthest : day
    revealing = { id: `head:${groupName({ kind: 'date', iso: day })}`, asked: revealing.asked + 1 }
  }

  /** The strip a week on or back, and the list brought to its first day; a board's
   *  columns move with it. */
  function step(weeks: number) {
    from = addDays(from, 7 * weeks)
    if (!board) show(from < live.today ? live.today : from)
    // The row that had the keyboard may scroll out of the window and go with it: the
    // keyboard stays in Upcoming, so the next Shift and arrow is heard too.
    requestAnimationFrame(() => {
      if (host && !host.contains(document.activeElement)) host.focus({ preventScroll: true })
    })
  }

  let host = $state<HTMLElement>()

  /** Shift and an arrow: Todoist's keys for the week before and after. */
  function keydown(event: KeyboardEvent) {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]'))
      return
    const back = shortcuts.pressed('tasks.week-back', event)
    if (!back && !shortcuts.pressed('tasks.week-on', event)) return
    event.preventDefault()
    step(back ? -1 : 1)
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="upcoming"
  bind:this={host}
  tabindex="-1"
  role="group"
  aria-label={t('Upcoming')}
  onkeydown={keydown}
>
  <div class="top">
    <span class="month">{month}</span>
    <button
      type="button"
      class="nib-chip is-quiet"
      onclick={() => {
        from = live.today
        show(live.today)
      }}>{t('Today')}</button
    >
  </div>
  <div class="strip">
    <button type="button" class="nib-glyph" aria-label={t('Back')} onclick={() => step(-1)}>
      <svg viewBox="0 0 13 13"><path d="M8 2.5 4 6.5l4 4" /></svg>
    </button>
    {#each week as day (day)}
      <button
        type="button"
        class="day"
        class:today={day === live.today}
        class:past={day < live.today}
        use:droppable={(row) => kit.drop(row, day, 'task.date')}
        onclick={() => show(day)}
      >
        <span class="weekday">{i18n.when(dateAt(day), { weekday: 'short' })}</span>
        <span class="number">{Number(day.slice(8))}</span>
        <span class="count">{counts.get(day) ?? ''}</span>
      </button>
    {/each}
    <button type="button" class="nib-glyph" aria-label={t('Forward')} onclick={() => step(1)}>
      <svg viewBox="0 0 13 13"><path d="m5 2.5 4 4-4 4" /></svg>
    </button>
  </div>
  {#if board}
    <div class="days board">
      <BoardLayout
        {kit}
        days={{ from: from < live.today ? live.today : from, through: addDays(from, 13) }}
      />
    </div>
  {:else}
    <div class="days">
      <ListLayout
        {kit}
        dated={false}
        days={{ from: live.today, through }}
        onnearend={further}
        reveal={revealing}
      />
    </div>
  {/if}
</div>

<style>
  .upcoming {
    outline: none;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4) 0;
  }

  .month {
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
  }

  .strip {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .strip svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .day {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
    padding: var(--space-1) 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .day:hover {
      background: var(--surface-hover);
    }
  }

  .day.past {
    color: var(--muted);
  }

  .weekday {
    font-size: var(--text-xs);
  }

  .number {
    color: var(--text-strong);
    font-size: var(--text-base);
    font-variant-numeric: tabular-nums;
  }

  .today .number {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  .count {
    min-height: 1em;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .day:global(.is-taking) {
    background: var(--surface-selected);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .days {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* The board scrolls its own columns, sideways and each down its own. */
  .days.board {
    overflow: hidden;
  }
</style>
