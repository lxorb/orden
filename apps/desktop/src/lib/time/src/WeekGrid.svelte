<script lang="ts">
  import { localDate, midnightOf } from '../../platform/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { isOwn } from './counted'
  import { daysAfter, HOUR, piecesIn } from './days'
  import { activeIn, hoursShown, stacked } from './lanes'
  import { clock, length, nameOf, tintOf } from './look'
  import type { Minute } from './minutes'
  import { dayTotals } from './schedule'
  import { time } from './time.svelte'

  const {
    from,
    minutes,
    now,
    onpick,
  }: {
    from: number
    minutes: readonly Minute[]
    now: number
    onpick: (day: number, span: string | null) => void
  } = $props()
  const PER_HOUR = 44
  const days = $derived(Array.from({ length: 7 }, (_, index) => daysAfter(from, index)))
  const own = $derived(time.spans.filter(isOwn))
  const bounds = $derived.by((): [number, number] => {
    const times = [
      ...piecesIn(own, from, daysAfter(from, 7), now).flatMap((one) => [
        one.from - midnightOf(one.from),
        one.to - midnightOf(Math.max(one.from, one.to - 1)),
      ]),
      ...minutes.map((one) => one.at - midnightOf(one.at)),
    ]
    return hoursShown(0, 24 * HOUR, times)
  })
  const span = $derived(bounds[1] - bounds[0])
  const top = (day: number, at: number) => `${((at - day - bounds[0]) / span) * 100}%`
  const tall = (ms: number) => `${Math.max(0.6, (ms / span) * 100)}%`
  const hours = $derived.by(() => {
    const out: number[] = []
    for (let one = bounds[0]; one <= bounds[1]; one += HOUR) out.push(one)
    return out
  })
  const columns = $derived(
    days.map((day) => {
      const totals = dayTotals(time.spans, day, now)
      return {
        day,
        pieces: stacked(piecesIn(own, day + bounds[0], day + bounds[1], now)),
        whole: totals.ms,
        totals,
        active: activeIn(minutes, day, daysAfter(day, 1)),
        nowShown: day + bounds[0] <= now && now <= day + bounds[1],
      }
    }),
  )
  const week = $derived.by(() => {
    const out: { activity: string | null; ms: number }[] = []
    for (const column of columns) {
      for (const slice of column.totals.slices) {
        const held = out.find((one) => one.activity === slice.activity)
        if (held) held.ms += slice.ms
        else out.push({ ...slice })
      }
    }
    return out.sort((one, other) => other.ms - one.ms)
  })
</script>

<div class="week" style:--rows={span / HOUR} style:--per-hour="{PER_HOUR}px" dir="ltr">
  <div class="corner"></div>
  {#each columns as column (column.day)}
    <button
      type="button"
      class="head"
      class:today={column.day === midnightOf(now)}
      data-day={column.day}
      onclick={() => onpick(column.day, null)}
    >
      <span class="name">{localDate(column.day, { weekday: 'short', day: 'numeric' })}</span>
      <span class="total">{column.whole ? length(column.whole) : ''}</span>
      <span class="total active">{column.active ? `${length(column.active)} active` : ''}</span>
    </button>
  {/each}

  <div class="hours" aria-hidden="true">
    {#each hours as hour (hour)}
      <span style:top="{((hour - bounds[0]) / span) * 100}%">{localDate(from + hour, { hour: 'numeric' })}</span>
    {/each}
  </div>
  {#each columns as column (column.day)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="column"
      class:today={column.day === midnightOf(now)}
      onclick={(event) => {
        if (event.target === event.currentTarget) onpick(column.day, null)
      }}
    >
      {#each column.pieces as { item: piece, row, rows } (piece.span.id)}
        <button
          type="button"
          class="block"
          style:--row={row}
          style:--rows={rows}
          style:top={top(column.day, piece.from)}
          style:height={tall(piece.to - piece.from)}
          style:--tint={tintOf(piece.span.activity)}
          title="{nameOf(piece.span.activity, 'No activity')}, {clock(piece.from)}–{clock(piece.to)}"
          onclick={() => onpick(column.day, piece.span.id)}
        >
          {#if (piece.to - piece.from) / HOUR >= 0.6}
            <span class="what"
              ><ActivityMark activity={piece.span.activity} size={12} /><span class="name"
                >{nameOf(piece.span.activity, 'No activity')}</span
              ></span
            >
            <span class="long">{length(piece.to - piece.from)}</span>
          {/if}
        </button>
      {/each}
      {#if column.nowShown}
        <span class="now" style:top={top(column.day, now)}></span>
      {/if}
    </div>
  {/each}
</div>

{#if week.length}
  <ul class="totals" data-time-week>
    {#each week as one (one.activity)}
      {@const goal = one.activity === null ? null : time.goalFor(one.activity, 'week')}
      <li class="orden-row is-short">
        <ActivityMark activity={one.activity} />
        <span class="orden-row-label" dir="auto">{nameOf(one.activity, 'No activity')}</span>
        {#if goal}
          <div class="goal">
            <div
              class="orden-meter"
              role="meter"
              aria-label="Weekly goal"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(Math.min(1, one.ms / goal.ms) * 100)}
            >
              <div class="orden-meter-fill" style:width="{Math.min(1, one.ms / goal.ms) * 100}%"></div>
            </div>
          </div>
        {/if}
        <span class="orden-row-meta">{length(one.ms)}{goal ? ` / ${length(goal.ms)}` : ''}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .week {
    display: grid;
    grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr));
    grid-template-rows: auto calc(var(--rows) * var(--per-hour));
    column-gap: 4px;
    row-gap: var(--space-2);
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: var(--space-1) 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
    cursor: default;
  }
  @media (hover: hover) {
    .head:hover {
      background: var(--surface-hover);
    }
  }
  .head.today .name {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }
  .total {
    min-height: 1.2em;
    color: var(--text-strong);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .total.active {
    color: var(--muted);
  }
  .hours {
    position: relative;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .hours span {
    position: absolute;
    right: var(--space-2);
    translate: 0 -50%;
    white-space: nowrap;
  }
  .column {
    position: relative;
    border-radius: var(--radius-sm);
    background: repeating-linear-gradient(
      to bottom,
      var(--surface-2) 0 calc(var(--per-hour) - 1px),
      var(--line) calc(var(--per-hour) - 1px) var(--per-hour)
    );
  }
  .column.today {
    box-shadow: inset 0 0 0 1px var(--accent-soft);
  }
  .block {
    position: absolute;
    left: calc(2px + (100% - 4px) * var(--row) / var(--rows));
    width: calc((100% - 4px) / var(--rows) - 2px);
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 3px;
    padding: 3px var(--space-1) 3px calc(var(--space-1) + 3px);
    overflow: hidden;
    border: none;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--tint) 26%, var(--surface));
    box-shadow: inset 3px 0 0 var(--tint);
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
    cursor: default;
  }
  .what {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    font-weight: var(--weight-strong);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .long {
    color: var(--muted-strong);
    font-variant-numeric: tabular-nums;
  }
  .now {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    margin-top: -1px;
    background: var(--danger);
    pointer-events: none;
  }
  .totals {
    max-width: 22rem;
    margin: var(--space-5) 0 0;
    padding: 0;
    list-style: none;
  }
  .goal {
    flex: 0 0 6rem;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
</style>
