<script lang="ts">
  import { localDate } from '../../platform/src/api'
  import { HOUR, MINUTE } from './days'
  import type { Picked } from './lanes'
  import { clock, length, placeTint } from './look'
  import type { Minute } from './minutes'
  import type { Lane } from './records'
  import Schedule from './Schedule.svelte'
  import { barsOf, levelsOf, slotsFor } from './slots'
  import { time } from './time.svelte'

  const {
    from,
    to,
    minutes,
    now,
    selected,
    range,
    onselect,
    onrange,
    onmanage,
  }: {
    from: number
    to: number
    minutes: readonly Minute[]
    now: number
    selected: string | null
    range: Picked | null
    onselect: (id: string | null) => void
    onrange: (next: Picked | null) => void
    onmanage: () => void
  } = $props()
  const SNAP = 5 * MINUTE
  const LANES: readonly [Lane, string][] = [
    ['app', 'Apps'],
    ['site', 'Websites'],
    ['space', 'Spaces'],
    ['tab', 'Tabs'],
  ]
  let width = $state(0)
  const whole = $derived(to - from)
  const slots = $derived(slotsFor(width))
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${(ms / whole) * 100}%`
  const pixels = (ms: number) => (ms / whole) * width
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
  let rowsBox = $state<HTMLElement | null>(null)
  let pressed: { x: number; at: number } | null = null
  let dragging = false
  function timeAt(x: number): number {
    const box = rowsBox?.getBoundingClientRect()
    if (!box?.width) return from
    return Math.round((from + Math.min(1, Math.max(0, (x - box.left) / box.width)) * whole) / SNAP) * SNAP
  }
  function down(event: PointerEvent) {
    if (event.button !== 0) return
    pressed = { x: event.clientX, at: timeAt(event.clientX) }
    rowsBox?.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    if (!pressed || (!dragging && Math.abs(event.clientX - pressed.x) < 4)) return
    dragging = true
    const here = timeAt(event.clientX)
    onrange({ from: Math.min(pressed.at, here), to: Math.max(pressed.at, here, Math.min(pressed.at, here) + SNAP) })
  }
  function up() {
    if (!dragging && pressed) onrange(null)
    pressed = null
    dragging = false
  }
</script>

<div class="day" dir="ltr">
  <div class="labels" aria-hidden="true">
    <span class="axis"></span>
    <span class="schedule-label"></span>
    {#each rows as row (row.lane)}<span class="lane-label">{row.label}</span>{/each}
    <span class="active-label">Active</span>
  </div>

  <div class="track" bind:clientWidth={width}>
    <div class="axis" aria-hidden="true">
      {#each hours as hour (hour)}<span style:left={at(hour)}>{localDate(hour, { hour: 'numeric' })}</span>{/each}
    </div>
    <Schedule {from} {to} {now} {minutes} {width} {selected} {onselect} {onmanage} />
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="rows"
      bind:this={rowsBox}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={() => {
        pressed = null
        dragging = false
      }}
    >
      {#each rows as row (row.lane)}
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
      {#if range}
        <span
          class="range"
          style:left={at(Math.max(from, range.from))}
          style:width={wide(Math.min(to, range.to) - Math.max(from, range.from))}
        ></span>
      {/if}
    </div>
    {#each hours as hour (hour)}<span class="tick" style:left={at(hour)}></span>{/each}
    {#if nowShown}<span class="now" style:left={at(now)}></span>{/if}
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
    translate: -50% 0;
    white-space: nowrap;
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: crosshair;
    touch-action: pan-y;
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
  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    border-inline: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
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
