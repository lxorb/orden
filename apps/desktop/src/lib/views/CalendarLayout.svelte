<script lang="ts">
  import { cellValue, type Row, rowId, type TaskChange } from '@orden/bases'
  import { untrack } from 'svelte'
  import { i18n, t } from '../i18n.svelte'
  import { linkModifier } from '@orden/editor'
  import {
    type CalendarMode,
    CALENDAR_MODES,
    daysShown,
    type Placed,
    placedByDay,
    stepped,
    timeOf,
  } from './calendar'
  import { dateAt } from './days'
  import { hourDrop } from './drop'
  import { draggable, droppable, type Point } from './drag.svelte'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import { everyRow } from './list-items'
  import { priorityTone } from '../quick-add/labels'
  import { dayIn } from './values'
  import { arrive } from '../slide'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)

  let mode = $state<CalendarMode>('month')
  let anchor = $state(untrack(() => kit.live.today))

  const first = $derived.by(() => {
    try {
      const locale = new Intl.Locale(i18n.language) as Intl.Locale & {
        getWeekInfo?: () => { firstDay?: number }
      }
      return (locale.getWeekInfo?.().firstDay ?? 1) % 7
    } catch {
      return 1
    }
  })

  const days = $derived(daysShown(mode, anchor, first))
  const dateProperty = $derived(view?.orden.date ?? 'task.date')
  const rows = $derived(everyRow(live.answer?.groups ?? []))
  const placed = $derived(
    placedByDay(rows, days, (row) => {
      const base = live.base
      if (!base) return null
      return dayIn(cellValue(base, dateProperty, row, live.context))
    }),
  )

  const title = $derived(
    mode === 'month'
      ? i18n.when(dateAt(anchor), { month: 'long', year: 'numeric' })
      : i18n.when(dateAt(days[0] ?? anchor), { month: 'long', year: 'numeric' }),
  )

  const MODE_NAMES: Record<CalendarMode, string> = {
    month: t('Month'),
    week: t('Week'),
    days3: t('3 days'),
    day: t('Day'),
  }

  const HOUR = 44

  const labelOf = (row: Row) => (row.task ? plain(row.task.text) : row.file.basename)

  function onDay(row: Row, day: string) {
    kit.drop(row, day, dateProperty)
  }

  function onHour(row: Row, day: string, at: Point, place: HTMLElement) {
    if (!row.task) {
      onDay(row, day)
      return
    }
    const box = place.getBoundingClientRect()
    const minutes = Math.round((((at.y - box.top) / HOUR) * 60) / 15) * 15
    const drop = hourDrop(dateProperty, day, timeOf(minutes), row, live.today)
    if (drop && 'change' in drop) kit.write(row, drop.change)
  }

  function lasting(minutes: number): TaskChange {
    const change: TaskChange = {}
    change.duration = minutes
    return change
  }

  function stretch(event: PointerEvent, one: Placed) {
    event.preventDefault()
    event.stopPropagation()
    const start = event.clientY
    const was = one.minutes ?? 30
    const block = (event.currentTarget as HTMLElement).parentElement
    const move = (next: PointerEvent) => {
      if (block)
        block.style.height = `${Math.max(15, was + ((next.clientY - start) / HOUR) * 60) * (HOUR / 60)}px`
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const minutes = Math.max(
        15,
        Math.round((was + ((next.clientY - start) / HOUR) * 60) / 15) * 15,
      )
      if (minutes !== was) kit.write(one.row, { task: lasting(minutes) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  let hours = $state<HTMLElement>()
  $effect(() => {
    if (hours && mode !== 'month') hours.scrollTop = HOUR * 7
  })
</script>

{#snippet item(one: Placed, timed: boolean)}
  {@const label = labelOf(one.row)}
  <div
    class="event"
    class:ghost={one.ghost}
    class:timed
    class:done={one.row.task?.done}
    role="button"
    tabindex={one.ghost ? -1 : 0}
    style:--tone={one.row.task ? priorityTone(one.row.task.priority) : null}
    style:top={timed && one.start !== undefined ? `${(one.start / 60) * HOUR}px` : null}
    style:height={timed && one.minutes !== undefined
      ? `${Math.max(18, (one.minutes / 60) * HOUR)}px`
      : null}
    use:draggable={{ row: one.row, label, disabled: one.ghost === true }}
    onclick={(event) => kit.choose(one.row, linkModifier(event))}
    onkeydown={(event) => {
      if (event.key === 'Enter') kit.choose(one.row)
    }}
  >
    {#if one.row.task?.recurrence}<span class="repeat" aria-hidden="true">↻</span>{/if}
    {#if timed && one.row.task?.time}<span class="time">{one.row.task.time}</span>{/if}
    <span class="label">{label}</span>
    {#if timed && !one.ghost}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="edge" onpointerdown={(event) => stretch(event, one)}></span>
    {/if}
  </div>
{/snippet}

<div class="calendar">
  <div class="bar">
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('Back')}
      onclick={() => (anchor = stepped(mode, anchor, -1))}
    >
      <svg viewBox="0 0 13 13"><path d="M8 2.5 4 6.5l4 4" /></svg>
    </button>
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('Forward')}
      onclick={() => (anchor = stepped(mode, anchor, 1))}
    >
      <svg viewBox="0 0 13 13"><path d="m5 2.5 4 4-4 4" /></svg>
    </button>
    <span class="title">{title}</span>
    <button type="button" class="orden-chip is-quiet" onclick={() => (anchor = live.today)}
      >{t('Today')}</button
    >
    <span class="spring"></span>
    <div class="orden-segmented modes" role="tablist">
      {#each CALENDAR_MODES as one (one)}
        <button
          type="button"
          role="tab"
          class:on={mode === one}
          aria-selected={mode === one}
          onclick={() => (mode = one)}>{MODE_NAMES[one]}</button
        >
      {/each}
    </div>
  </div>

  <div class="body">
    {#if placed.undated.length}
      <div class="tray" use:droppable={(row) => kit.drop(row, null, dateProperty)}>
        {#each placed.undated as row (`${row.space}:${rowId(row)}`)}
          {@render item({ row, day: '' }, false)}
        {/each}
      </div>
    {/if}

    {#key `${mode}:${days[0]}`}
      <div class="sheet" in:arrive>
        {#if mode === 'month'}
          <div class="weekdays">
            {#each days.slice(0, 7) as day (day)}
              <span>{i18n.when(dateAt(day), { weekday: 'short' })}</span>
            {/each}
          </div>
          <div class="month" style:--weeks={days.length / 7}>
            {#each days as day (day)}
              {@const here = placed.byDay.get(day) ?? []}
              <div
                class="day"
                class:other={day.slice(5, 7) !== anchor.slice(5, 7)}
                class:today={day === live.today}
                use:droppable={(row) => onDay(row, day)}
              >
                <span class="number">{Number(day.slice(8))}</span>
                {#each here.slice(0, 4) as one (`${one.row.space}:${rowId(one.row)}:${one.day}`)}
                  {@render item(one, false)}
                {/each}
                {#if here.length > 4}
                  <button
                    type="button"
                    class="more"
                    onclick={() => {
                      anchor = day
                      mode = 'day'
                    }}>+{here.length - 4}</button
                  >
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="columns" style:--count={days.length}>
            <span class="gutter"></span>
            {#each days as day (day)}
              <div class="column-head" class:today={day === live.today}>
                <span>{i18n.when(dateAt(day), { weekday: 'short' })}</span>
                <span class="number">{Number(day.slice(8))}</span>
              </div>
            {/each}
            <span class="gutter"></span>
            {#each days as day (day)}
              <div class="all-day" use:droppable={(row) => onDay(row, day)}>
                {#each (placed.byDay.get(day) ?? []).filter((one) => one.start === undefined) as one (`${one.row.space}:${rowId(one.row)}:${one.day}`)}
                  {@render item(one, false)}
                {/each}
              </div>
            {/each}
          </div>
          <div class="hours" bind:this={hours}>
            <div class="columns grid" style:--count={days.length} style:height={`${HOUR * 24}px`}>
              <div class="gutter times">
                {#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
                  <span style:top={`${hour * HOUR}px`}>{hour ? timeOf(hour * 60) : ''}</span>
                {/each}
              </div>
              {#each days as day (day)}
                <div
                  class="hour-column"
                  class:today={day === live.today}
                  use:droppable={(row, at, place) => onHour(row, day, at, place)}
                >
                  {#each (placed.byDay.get(day) ?? []).filter((one) => one.start !== undefined) as one (`${one.row.space}:${rowId(one.row)}:${one.day}`)}
                    {@render item(one, true)}
                  {/each}
                  {#if day === live.today}
                    {@const now = new Date()}
                    <span
                      class="now"
                      style:top={`${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR}px`}
                    ></span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }

  .bar svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .title {
    margin: 0 var(--space-2);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .spring {
    flex: 1;
  }

  .modes button {
    padding: 0 var(--space-3);
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .tray {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 180px;
    padding: var(--space-2);
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
  }

  .sheet {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .weekdays,
  .month {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .weekdays span {
    padding: var(--space-1) var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .month {
    flex: 1;
    grid-template-rows: repeat(var(--weeks), minmax(84px, 1fr));
    overflow-y: auto;
    border-top: 1px solid var(--line);
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: var(--space-1);
    border-inline-end: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    overflow: hidden;
  }

  .day.other {
    background: color-mix(in srgb, var(--surface-2) 50%, transparent);
  }

  .number {
    align-self: flex-end;
    padding: 0 var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .today .number {
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
  }

  .more {
    align-self: flex-start;
    padding: 0 var(--space-1);
    border: none;
    background: none;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .columns {
    display: grid;
    grid-template-columns: 52px repeat(var(--count), minmax(0, 1fr));
  }

  .column-head {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1);
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .all-day {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 26px;
    padding: 2px;
    border-inline-end: 1px solid var(--line);
    border-bottom: 1px solid var(--line-strong);
  }

  .hours {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .grid {
    position: relative;
  }

  .times {
    position: relative;
  }

  .times span {
    position: absolute;
    inset-inline-end: var(--space-2);
    translate: 0 -50%;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .hour-column {
    position: relative;
    border-inline-end: 1px solid var(--line);
    background-image: repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px 44px);
  }

  .hour-column.today {
    background-color: color-mix(in srgb, var(--accent) 4%, transparent);
  }

  .now {
    position: absolute;
    inset-inline: 0;
    height: 2px;
    background: var(--accent);
  }

  .event {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding: 1px var(--space-2);
    border-inline-start: 3px solid var(--tone, var(--accent));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--tone, var(--accent)) 14%, var(--surface));
    color: var(--text);
    font-size: var(--text-xs);
    cursor: default;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .event.timed {
    position: absolute;
    inset-inline: 2px;
    align-items: flex-start;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }

  .event.ghost {
    opacity: 0.45;
    border-inline-start-style: dashed;
  }

  .event.done .label {
    text-decoration: line-through;
    color: var(--muted);
  }

  .event:global(.is-carried) {
    opacity: 0.3;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time,
  .repeat {
    flex: none;
    color: var(--muted-strong);
    font-variant-numeric: tabular-nums;
  }

  .edge {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
    touch-action: none;
  }

  .day:global(.is-taking),
  .all-day:global(.is-taking),
  .hour-column:global(.is-taking),
  .tray:global(.is-taking) {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
