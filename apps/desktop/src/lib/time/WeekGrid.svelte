<script lang="ts">
  import { localDate } from '../region'
  import { dayOf, daysAfter, HOUR, MINUTE, piecesIn, wholeOf } from './days'
  import { bucketsOf, hoursShown, stacked } from './lanes'
  import { clock, length, nameOf, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Span } from './records'

  const {
    from,
    said,
    minutes,
    now,
    onpick,
  }: {
    from: number
    said: readonly Span[]
    minutes: readonly Minute[]
    now: number
    onpick: (day: number, span: string | null) => void
  } = $props()

  const PER_HOUR = 44

  const days = $derived(Array.from({ length: 7 }, (_, index) => daysAfter(from, index)))
  const bounds = $derived.by((): [number, number] => {
    const times = [
      ...piecesIn(said, from, daysAfter(from, 7), now).flatMap((one) => [
        one.from - dayOf(one.from),
        one.to - dayOf(Math.max(one.from, one.to - 1)),
      ]),
      ...minutes.map((one) => one.at - dayOf(one.at)),
    ]
    const [start, end] = hoursShown(0, 24 * HOUR, times)
    return [start, end]
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
      const shownFrom = day + bounds[0]
      const shownTo = day + bounds[1]
      const pieces = stacked(piecesIn(said, shownFrom, shownTo, now))
      return {
        day,
        pieces,
        whole: wholeOf(piecesIn(said, day, daysAfter(day, 1), now)),
        buckets: bucketsOf(minutes, shownFrom, shownTo, 15 * MINUTE),
        nowShown: shownFrom <= now && now <= shownTo,
      }
    }),
  )
</script>

<div class="week" style:--rows={span / HOUR} style:--per-hour="{PER_HOUR}px" dir="ltr">
  <div class="corner"></div>
  {#each columns as column (column.day)}
    <button
      type="button"
      class="head"
      class:today={column.day === dayOf(now)}
      onclick={() => onpick(column.day, null)}
    >
      <span class="name">{localDate(column.day, { weekday: 'short', day: 'numeric' })}</span>
      <span class="total">{column.whole ? length(column.whole) : ''}</span>
    </button>
  {/each}

  <div class="hours" aria-hidden="true">
    {#each hours as hour (hour)}
      <span style:top="{((hour - bounds[0]) / span) * 100}%">{clock(from + hour)}</span>
    {/each}
  </div>
  {#each columns as column (column.day)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="column"
      class:today={column.day === dayOf(now)}
      onclick={(event) => {
        if (event.target === event.currentTarget) onpick(column.day, null)
      }}
    >
      {#each column.buckets as bucket (bucket.from)}
        {#if bucket.seen > 0}
          <span
            class="busy"
            style:top={top(column.day, bucket.from)}
            style:height={tall(15 * MINUTE)}
            style:opacity={0.15 + 0.85 * Math.min(1, bucket.active / bucket.seen)}
          ></span>
        {/if}
      {/each}
      {#each column.pieces as { item: piece, row, rows } (piece.span.id)}
        <button
          type="button"
          class="block"
          style:--row={row}
          style:--rows={rows}
          style:top={top(column.day, piece.from)}
          style:height={tall(piece.to - piece.from)}
          style:--tint={tintOf(piece.span.activity)}
          title="{nameOf(piece.span.activity, 'No activity')}, {clock(piece.from)}–{clock(
            piece.to,
          )}"
          onclick={() => onpick(column.day, piece.span.id)}
        >
          {#if (piece.to - piece.from) / HOUR >= 0.6}
            <span class="what">{nameOf(piece.span.activity, 'No activity')}</span>
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

<style>
  .week {
    display: grid;
    grid-template-columns: 4rem repeat(7, minmax(0, 1fr));
    grid-template-rows: auto calc(var(--rows) * var(--per-hour));
    column-gap: 4px;
    row-gap: var(--space-2);
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-1) 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .head.today .name {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  .total {
    min-height: 1.2em;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
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
    cursor: pointer;
  }

  .busy {
    position: absolute;
    left: 0;
    width: 4px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  .block {
    position: absolute;
    left: calc(8px + (100% - 11px) * var(--row) / var(--rows));
    width: calc((100% - 11px) / var(--rows) - 2px);
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 3px;
    padding: 3px var(--space-1);
    overflow: hidden;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--tint);
    color: var(--accent-ink);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
    cursor: pointer;
  }

  .what {
    overflow: hidden;
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .long {
    opacity: 0.85;
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
</style>
