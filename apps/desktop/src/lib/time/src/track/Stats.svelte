<script lang="ts">
  import { midnightOf } from '../../../platform/src/api'
  import { DateField } from '../../../ui-controls/src/api'
  import ActivityMark from '../ActivityMark.svelte'
  import { daysAfter, endOf, startOf } from '../days'
  import { length, nameOf, tintOf } from '../look'
  import Pie from '../Pie.svelte'
  import { rangeTotals } from '../schedule'
  import { time } from '../time.svelte'
  import { watchedMinutes } from '../watched.svelte'
  import { dayIso, isoDay, type StatsRange, withinRange } from './range'

  const {
    now,
    range,
    onrange,
    onpick,
  }: {
    now: number
    range: StatsRange
    onrange: (range: StatsRange) => void
    onpick: (activity: string | null, day: number) => void
  } = $props()
  type Kind = StatsRange['kind']
  const RANGES: readonly { id: Kind; label: string }[] = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'custom', label: 'Custom' },
  ]
  const today = $derived(midnightOf(now))
  const from = $derived(range.kind === 'custom' ? range.from : startOf(range.kind, today))
  const to = $derived(range.kind === 'custom' ? daysAfter(range.to, 1) : endOf(range.kind, from))
  const minutes = watchedMinutes(() => [from, to])
  const totals = $derived(rangeTotals(time.spans, minutes.list, from, to, now, { untracked: false }))
  const rows = $derived([...totals.slices].sort((one, other) => other.ms - one.ms))
  const goals = $derived(range.kind === 'custom' ? [] : time.goals.filter((one) => one.per === range.kind))
  const done = (activity: string) => totals.slices.find((one) => one.activity === activity)?.ms ?? 0
  function chosen(kind: Kind) {
    if (kind !== 'custom') onrange({ kind })
    else if (range.kind !== 'custom') onrange({ kind, from: daysAfter(today, -6), to: today })
  }
  function bound(which: 'from' | 'to', iso: string) {
    const day = isoDay(iso)
    if (day === null || range.kind !== 'custom') return
    onrange(withinRange({ ...range, [which]: day }, which, today))
  }
</script>

<div class="ranges" role="tablist" aria-label="Range">
  {#each RANGES as one (one.id)}
    <button
      type="button"
      role="tab"
      class="range"
      class:on={range.kind === one.id}
      aria-selected={range.kind === one.id}
      data-track-range={one.id}
      onclick={() => chosen(one.id)}>{one.label}</button
    >
  {/each}
</div>
{#if range.kind === 'custom'}
  <div class="bounds" data-track-bounds>
    <DateField label="From" value={dayIso(range.from)} onchange={(iso: string) => bound('from', iso)} />
    <DateField label="To" value={dayIso(range.to)} onchange={(iso: string) => bound('to', iso)} />
  </div>
{/if}
<div class="pie" data-track-total={totals.ms}><Pie slices={totals.slices} ms={totals.ms} /></div>
<ul class="rows">
  {#each rows as row (row.activity)}
    <li>
      <button
        type="button"
        class="row"
        style:--tint={tintOf(row.activity)}
        data-track-row={nameOf(row.activity, 'Not set')}
        onclick={() => onpick(row.activity, range.kind === 'custom' ? range.to : today)}
      >
        <ActivityMark activity={row.activity} size={20} />
        <span class="name">{nameOf(row.activity, 'Not set')}</span>
        <span class="ms">{length(row.ms)}</span>
        <span class="share">{Math.round((row.ms / Math.max(totals.ms, 1)) * 100)}%</span>
      </button>
    </li>
  {/each}
</ul>
{#if goals.length}
  <ul class="rows goals" aria-label="Goals">
    {#each goals as goal (goal.id)}
      <li class="row" style:--tint={tintOf(goal.activity)}>
        <ActivityMark activity={goal.activity} size={20} />
        <div class="bar" style:--accent={tintOf(goal.activity)}>
          <div
            class="orden-meter"
            role="meter"
            aria-label={nameOf(goal.activity, 'Goal')}
            aria-valuemin={0}
            aria-valuemax={goal.ms}
            aria-valuenow={Math.min(done(goal.activity), goal.ms)}
          >
            <div class="orden-meter-fill" style:width="{Math.min(1, done(goal.activity) / goal.ms) * 100}%"></div>
          </div>
        </div>
        <span class="ms">{length(done(goal.activity))} / {length(goal.ms)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .ranges {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--surface);
  }
  .range {
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
  }
  .range.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .bounds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .bounds > :global(*) {
    flex: 1 1 9rem;
    min-width: 0;
  }
  .bounds :global(button),
  .bounds :global(input) {
    min-height: var(--touch-target);
  }
  .pie {
    display: grid;
    place-items: center;
    padding: var(--space-2) 0;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-row);
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: 14px;
    background: color-mix(in srgb, var(--tint) 12%, var(--surface));
    color: var(--text);
    font: inherit;
    text-align: start;
    -webkit-tap-highlight-color: transparent;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .ms,
  .share {
    font-variant-numeric: tabular-nums;
  }
  .share {
    min-width: 3.2em;
    text-align: end;
    color: var(--muted);
  }
  .bar {
    flex: 1;
    min-width: 0;
  }
</style>
