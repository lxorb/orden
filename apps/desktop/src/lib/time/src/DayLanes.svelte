<script lang="ts">
  import { localDate } from '../../platform/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { isOwn } from './counted'
  import { HOUR, piecesIn } from './days'
  import { clock, length, nameOf, placeTint, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Lane } from './records'
  import { barsOf, levelsOf, slotsFor } from './slots'
  import { time } from './time.svelte'

  const { from, to, minutes, now }: { from: number; to: number; minutes: readonly Minute[]; now: number } = $props()
  const LANES: readonly [Lane, string][] = [
    ['space', 'Spaces'],
    ['site', 'Websites'],
    ['tab', 'Tabs'],
    ['app', 'Apps'],
  ]
  let width = $state(0)
  const whole = $derived(to - from)
  const slots = $derived(slotsFor(width))
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${(ms / whole) * 100}%`
  const pixels = (ms: number) => (ms / whole) * width
  const blocks = $derived(piecesIn(time.spans, from, to, now, isOwn))
  const rows = $derived(
    LANES.map(([lane, label]) => ({ lane, label, bars: barsOf(time.spans, lane, from, to, slots, now) })),
  )
  const levels = $derived(levelsOf(minutes, from, to, slots))
  const nowShown = $derived(from <= now && now < to)
  const hours = $derived.by(() => {
    const out: number[] = []
    const step = [1, 2, 3, 4, 6, 12].map((one) => one * HOUR).find((one) => (one / whole) * width >= 56) ?? 12 * HOUR
    for (let one = Math.ceil(from / step) * step; one <= to; one += step) out.push(one)
    return out
  })
</script>

<div class="frame">
  <div class="day" dir="ltr">
    <div class="labels" aria-hidden="true">
      <span class="axis"></span>
      <span class="schedule-label"></span>
      {#each rows as row (row.lane)}<span class="lane-label">{row.label}</span>{/each}
      <span class="active-label">Active</span>
    </div>

    <div class="track" bind:clientWidth={width}>
      <div class="axis" aria-hidden="true">
        {#each hours as hour (hour)}<span
            style:left={at(hour)}
            style:translate={(hour - from) / whole < 0.06 ? '0 0' : (hour - from) / whole > 0.94 ? '-100% 0' : '-50% 0'}
            >{localDate(hour, { hour: 'numeric' })}</span
          >{/each}
      </div>
      <div class="schedule" data-time-schedule>
        {#each blocks as piece (piece.span.id)}
          <span
            class="block"
            style:left={at(piece.from)}
            style:width={wide(piece.to - piece.from)}
            style:--tint={tintOf(piece.span.activity)}
            title="{nameOf(piece.span.activity, 'Not set')}, {clock(piece.from)}–{clock(piece.to)}, {length(
              piece.to - piece.from,
            )}"
          >
            {#if pixels(piece.to - piece.from) > 22}
              <ActivityMark activity={piece.span.activity} size={12} />
              {#if pixels(piece.to - piece.from) > 64}<span class="what" dir="auto"
                  >{nameOf(piece.span.activity, 'Not set')}</span
                >{/if}
            {/if}
          </span>
        {/each}
      </div>
      <div class="rows">
        {#each rows as row (row.lane)}
          <span class="tag" aria-hidden="true">{row.label}</span>
          <div class="lane" data-lane={row.lane}>
            {#each row.bars as bar (bar.from)}
              <span
                class="bar"
                style:left={at(bar.from)}
                style:width={wide(bar.to - bar.from)}
                style:--tint={placeTint(bar.key)}
                title="{bar.label}, {clock(bar.from)}–{clock(bar.to)}, {length(bar.ms)}"
                dir="auto"
                >{#if pixels(bar.to - bar.from) >= 48}{bar.label}{/if}</span
              >
            {/each}
          </div>
        {/each}
        <span class="tag" aria-hidden="true">Active</span>
        <div class="lane active" data-lane="active">
          {#each levels as level (level.from)}
            <span
              class="level"
              style:left={at(level.from)}
              style:width={wide(level.to - level.from)}
              style:height="{Math.max(10, level.share * 100)}%"
              title="{clock(level.from)}–{clock(level.to)}, {Math.round(level.share * 100)}%"
            ></span>
          {/each}
        </div>
      </div>
      {#each hours as hour (hour)}<span class="tick" style:left={at(hour)}></span>{/each}
      {#if nowShown}<span class="now" style:left={at(now)}></span>{/if}
    </div>
  </div>
</div>

<style>
  .day {
    --axis: 18px;
    --schedule: 56px;
    --lane: 22px;
    --active: 26px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-3);
    user-select: none;
    -webkit-user-select: none;
  }
  .labels {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 4.5rem;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .labels span {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    white-space: nowrap;
  }
  .labels .axis {
    height: var(--axis);
  }
  .schedule-label {
    height: var(--schedule);
  }
  .lane-label {
    height: var(--lane);
  }
  .active-label {
    height: var(--active);
  }
  .track {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .axis {
    position: relative;
    height: var(--axis);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .axis span {
    position: absolute;
    white-space: nowrap;
  }
  .frame {
    container: time-day / inline-size;
    min-width: 0;
  }
  .tag {
    display: none;
  }
  @container time-day (max-width: 520px) {
    .day {
      grid-template-columns: minmax(0, 1fr);
    }
    .labels {
      display: none;
    }
    .tag {
      display: block;
      margin-bottom: -2px;
      color: var(--muted);
      font-size: var(--text-xs);
      line-height: 1.2;
    }
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .schedule {
    position: relative;
    height: var(--schedule);
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 2px;
    padding-inline: 6px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--tint) 26%, var(--surface));
    box-shadow: inset 3px 0 0 var(--tint);
    color: var(--text-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }
  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lane {
    position: relative;
    height: var(--lane);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    padding: 0 var(--space-1);
    overflow: hidden;
    background: color-mix(in srgb, var(--tint) 55%, var(--surface));
    color: var(--text-strong);
    font-size: var(--text-xs);
    line-height: var(--lane);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .active {
    height: var(--active);
  }
  .level {
    position: absolute;
    bottom: 0;
    background: var(--accent);
    opacity: 0.75;
  }
  .tick {
    position: absolute;
    top: var(--axis);
    bottom: 0;
    width: 1px;
    background: var(--line);
    opacity: 0.5;
    pointer-events: none;
  }
  .now {
    position: absolute;
    top: var(--axis);
    bottom: 0;
    width: 2px;
    translate: -1px 0;
    background: var(--danger);
    pointer-events: none;
  }
  @media (forced-colors: active) {
    .bar,
    .level {
      forced-color-adjust: none;
    }
  }
</style>
