<script lang="ts">
  import { tick, untrack } from 'svelte'
  import {
    dateOf,
    dayName,
    daysAfter,
    monthGrid,
    monthName,
    monthsAfter,
    todayIso,
    weekBounds,
    weekdayNames,
    weekStart,
  } from './calendar'

  const {
    value,
    onpick,
    label = 'Choose a date',
    autofocus = false,
  }: {
    value: string
    onpick: (iso: string) => void
    label?: string
    autofocus?: boolean
  } = $props()
  const today = todayIso()
  const first = weekStart()
  const names = weekdayNames(first)
  let cursor = $state(untrack(() => (dateOf(value) ? value : today)))
  let grid = $state<HTMLElement>()
  const weeks = $derived(monthGrid(cursor, first))
  const titled = $derived(monthName(cursor))
  async function moveTo(iso: string) {
    cursor = iso
    await tick()
    grid?.querySelector<HTMLElement>(`[data-day="${iso}"]`)?.focus()
  }
  function stepped(key: string, shift: boolean, rtl: boolean): string | null {
    const side = rtl ? -1 : 1
    switch (key) {
      case 'ArrowLeft':
        return daysAfter(cursor, -side)
      case 'ArrowRight':
        return daysAfter(cursor, side)
      case 'ArrowUp':
        return daysAfter(cursor, -7)
      case 'ArrowDown':
        return daysAfter(cursor, 7)
      case 'Home':
        return weekBounds(cursor, first).from
      case 'End':
        return weekBounds(cursor, first).to
      case 'PageUp':
        return monthsAfter(cursor, shift ? -12 : -1)
      case 'PageDown':
        return monthsAfter(cursor, shift ? 12 : 1)
      default:
        return null
    }
  }
  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    const next = stepped(event.key, event.shiftKey, getComputedStyle(event.currentTarget).direction === 'rtl')
    if (next === null) return
    event.preventDefault()
    void moveTo(next)
  }
  let focusing = untrack(() => autofocus)
  function focusOnMount(node: HTMLElement, current: boolean) {
    if (!focusing || !current) return
    focusing = false
    node.focus()
  }
</script>

<div class="calendar">
  <div class="head">
    <button
      type="button"
      class="orden-glyph turn"
      aria-label="Previous month"
      onclick={() => (cursor = monthsAfter(cursor, -1))}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
    </button>
    <span class="month" aria-live="polite">{titled}</span>
    <button
      type="button"
      class="orden-glyph turn"
      aria-label="Next month"
      onclick={() => (cursor = monthsAfter(cursor, 1))}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
    </button>
  </div>
  <table role="grid" aria-label="{label}, {titled}" bind:this={grid}>
    <thead>
      <tr>
        {#each names as name (name.long)}
          <th scope="col" abbr={name.long}><span aria-hidden="true">{name.short}</span></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each weeks as week (week[0]?.iso)}
        <tr>
          {#each week as day (day.iso)}
            <td role="gridcell" aria-selected={day.iso === value}>
              <button
                type="button"
                class="day"
                class:outside={!day.inMonth}
                class:chosen={day.iso === value}
                class:today={day.iso === today}
                data-day={day.iso}
                tabindex={day.iso === cursor ? 0 : -1}
                aria-label={dayName(day.iso)}
                aria-current={day.iso === today ? 'date' : undefined}
                use:focusOnMount={day.iso === cursor}
                onclick={() => onpick(day.iso)}
                {onkeydown}>{day.day}</button
              >
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    font-family: var(--font-ui);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .turn {
    width: 28px;
    height: 28px;
  }
  .turn > svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .turn:dir(rtl) > svg {
    transform: scaleX(-1);
  }
  .month {
    flex: 1;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: center;
  }
  table {
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    height: 24px;
    padding: 0;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: normal;
  }
  td {
    padding: 1px;
  }
  .day {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .day:hover {
      background: var(--accent-soft);
      color: var(--text-strong);
    }
  }
  .day.outside {
    color: var(--muted);
  }
  .day.today {
    border-color: var(--line-strong);
    color: var(--text-strong);
  }
  .day.chosen {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  :global([data-touch]) .day {
    width: var(--touch-target);
    height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
