<script lang="ts">
  import { MINUTE } from './days'
  import type { Measure, Reading, Workout } from './health'
  import { healthLine, SLEEP_STAGES, stepBars } from './health'
  import { clock, length } from './look'

  const {
    from,
    to,
    readings,
    workouts,
  }: { from: number; to: number; readings: readonly Reading[]; workouts: readonly Workout[] } = $props()
  let width = $state(0)
  const whole = $derived(to - from)
  const size = $derived(Math.max(MINUTE, Math.round(whole / Math.max(60, Math.floor(width / 3)) / MINUTE) * MINUTE))
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${(Math.max(ms, size) / whole) * 100}%`
  const inside = (kind: Measure) => readings.filter((one) => one.kind === kind && one.at >= from && one.at < to)
  const heart = $derived(healthLine(inside('heart'), from, to, size, 40, 190))
  const stress = $derived(healthLine(inside('stress'), from, to, size, 0, 100))
  const sleep = $derived.by(() => {
    const list = inside('sleep').sort((one, other) => one.at - other.at)
    return list.map((one, index) => {
      const next = list[index + 1]
      const end = next && next.at - one.at <= 2 * 3_600_000 ? next.at : one.at + MINUTE
      return { from: one.at, to: end, stage: SLEEP_STAGES[one.value] ?? 'unknown' }
    })
  })
  const steps = $derived(stepBars(inside('steps'), from, to, size))
  const shown = $derived(workouts.filter((one) => one.end > from && one.start < to))
  const lasts = $derived({
    heart: inside('heart').at(-1)?.value ?? null,
    stress: inside('stress').at(-1)?.value ?? null,
  })
</script>

<div class="health" dir="ltr" data-time-health>
  <div class="labels" aria-hidden="true">
    <span class="line-label">Heart rate</span>
    <span class="line-label">Stress</span>
    <span class="strip-label">Sleep</span>
    <span class="bar-label">Steps</span>
    {#if shown.length}<span class="strip-label">Workouts</span>{/if}
  </div>
  <div class="track" bind:clientWidth={width}>
    <div
      class="lane"
      data-health="heart"
      title={lasts.heart === null ? 'Heart rate' : `Heart rate, last ${String(Math.round(lasts.heart))} bpm`}
    >
      <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true"><path class="heart" d={heart} /></svg>
    </div>
    <div
      class="lane"
      data-health="stress"
      title={lasts.stress === null ? 'Stress' : `Stress, last ${String(Math.round(lasts.stress))}`}
    >
      <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true"><path class="stress" d={stress} /></svg>
    </div>
    <div class="lane strip" data-health="sleep">
      {#each sleep as part (part.from)}
        <span
          class="mark {part.stage}"
          style:left={at(part.from)}
          style:width={wide(part.to - part.from)}
          title="{part.stage === 'rem' ? 'REM' : part.stage.charAt(0).toUpperCase() + part.stage.slice(1)}, {clock(
            part.from,
          )}–{clock(part.to)}"
        ></span>
      {/each}
    </div>
    <div class="lane bars" data-health="steps">
      {#each steps as bar (bar.from)}
        <span
          class="step"
          style:left={at(bar.from)}
          style:width={wide(size)}
          style:height="{Math.max(8, bar.share * 100)}%"
          title="{String(Math.round(bar.count))} steps, {clock(bar.from)}"
        ></span>
      {/each}
    </div>
    {#if shown.length}
      <div class="lane strip" data-health="workouts">
        {#each shown as workout (workout.id)}
          <span
            class="mark workout"
            style:left={at(Math.max(from, workout.start))}
            style:width={wide(Math.min(to, workout.end) - Math.max(from, workout.start))}
            title="{workout.sport}, {clock(workout.start)}–{clock(workout.end)}, {length(workout.end - workout.start)}"
          ></span>
        {/each}
      </div>
    {/if}
    <div class="legend" aria-hidden="true">
      <span><i class="key heart"></i>Heart rate</span>
      <span><i class="key stress"></i>Stress</span>
      <span><i class="key deep"></i>Deep</span>
      <span><i class="key light"></i>Light</span>
      <span><i class="key rem"></i>REM</span>
      <span><i class="key awake"></i>Awake</span>
      <span><i class="key step"></i>Steps</span>
    </div>
  </div>
</div>

<style>
  .health {
    --line: 32px;
    --strip: 14px;
    --bars: 24px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-3);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
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
  .line-label {
    height: var(--line);
  }
  .strip-label {
    height: var(--strip);
  }
  .bar-label {
    height: var(--bars);
  }
  .track {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .lane {
    position: relative;
    height: var(--line);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .lane.strip {
    height: var(--strip);
  }
  .lane.bars {
    height: var(--bars);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  path {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .heart {
    stroke: var(--danger);
  }
  .stress {
    stroke: var(--accent);
  }
  .mark,
  .step {
    position: absolute;
  }
  .mark {
    top: 0;
    bottom: 0;
  }
  .step {
    bottom: 0;
    border-radius: 1px 1px 0 0;
    background: color-mix(in srgb, var(--success) 70%, transparent);
  }
  .deep {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }
  .light {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .rem {
    background: color-mix(in srgb, var(--accent) 65%, white);
  }
  .awake {
    background: color-mix(in srgb, var(--danger) 35%, transparent);
  }
  .workout {
    border-radius: 2px;
    background: color-mix(in srgb, var(--success) 60%, transparent);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .key {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .key.heart {
    background: var(--danger);
  }
  .key.stress {
    background: var(--accent);
  }
  .key.step {
    position: static;
    background: color-mix(in srgb, var(--success) 70%, transparent);
  }
</style>
