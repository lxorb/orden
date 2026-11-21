<script lang="ts">
  import { deviceSlots, gapsIn } from './machine'
  import { MINUTE } from './days'
  import { clock, length } from './look'
  import type { Minute } from './minutes'

  const { from, to, minutes }: { from: number; to: number; minutes: readonly Minute[] } = $props()
  let width = $state(0)
  const whole = $derived(to - from)
  const size = $derived(Math.max(MINUTE, Math.round(whole / Math.max(60, Math.floor(width / 4)) / MINUTE) * MINUTE))
  const slots = $derived(deviceSlots(minutes, from, to, size))
  const gaps = $derived(gapsIn(minutes, from, to))
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${(ms / whole) * 100}%`
  const x = (moment: number) => (((moment - from) / whole) * 1000).toFixed(1)
  function line(read: (one: (typeof slots)[number]) => number | null): string {
    const parts: string[] = []
    let open = false
    for (const one of slots) {
      const value = read(one)
      if (value === null) {
        open = false
        continue
      }
      parts.push(`${open ? 'L' : 'M'}${x(one.from + size / 2)},${(30 - value * 28).toFixed(1)}`)
      open = true
    }
    return parts.join(' ')
  }
  const battery = $derived(line((one) => one.battery))
  const cpu = $derived(line((one) => one.cpu))
  const memory = $derived(line((one) => one.memory))
  const runs = (test: (one: (typeof slots)[number]) => boolean) => {
    const out: { from: number; to: number }[] = []
    for (const one of slots) {
      if (!test(one)) continue
      const last = out.at(-1)
      if (last?.to === one.from) last.to = one.from + size
      else out.push({ from: one.from, to: one.from + size })
    }
    return out
  }
  const charging = $derived(runs((one) => one.charging))
  const screenOff = $derived(runs((one) => one.screenOff))
  const offline = $derived(runs((one) => one.offline))
  const percent = (value: number | null) => (value === null ? 'no reading' : `${Math.round(value * 100)}%`)
  const LINES = [
    ['battery', 'Battery'],
    ['cpu', 'CPU'],
    ['memory', 'Memory'],
  ] as const
  const paths = $derived({ battery, cpu, memory })
  const lasts = $derived({
    battery: slots.filter((one) => one.battery !== null).at(-1)?.battery ?? null,
    cpu: slots.filter((one) => one.cpu !== null).at(-1)?.cpu ?? null,
    memory: slots.filter((one) => one.memory !== null).at(-1)?.memory ?? null,
  })
</script>

<div class="device" dir="ltr" data-time-device>
  <div class="labels" aria-hidden="true">
    {#each LINES as [key, label] (key)}<span class="line-label">{label}</span>{/each}
    <span class="strip-label">State</span>
  </div>
  <div class="track" bind:clientWidth={width}>
    {#each LINES as [key, label] (key)}
      <div class="lane" data-device={key} title="{label}, last {percent(lasts[key])}">
        {#if key === 'battery'}
          {#each charging as run (run.from)}
            <span class="charging" style:left={at(run.from)} style:width={wide(run.to - run.from)}></span>
          {/each}
        {/if}
        <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
          <path class={key} d={paths[key]} />
        </svg>
      </div>
    {/each}
    <div class="lane strip" data-device="state">
      {#each gaps as gap (gap.from)}
        <span
          class="mark {gap.kind}"
          style:left={at(gap.from)}
          style:width={wide(gap.to - gap.from)}
          title="{gap.kind === 'off' ? 'Off' : 'Asleep'}, {clock(gap.from)}–{clock(gap.to)}, {length(
            gap.to - gap.from,
          )}"
        ></span>
      {/each}
      {#each screenOff as run (run.from)}
        <span
          class="mark screen"
          style:left={at(run.from)}
          style:width={wide(run.to - run.from)}
          title="Screen off, {clock(run.from)}–{clock(run.to)}"
        ></span>
      {/each}
      {#each offline as run (run.from)}
        <span
          class="mark offline"
          style:left={at(run.from)}
          style:width={wide(run.to - run.from)}
          title="Offline, {clock(run.from)}–{clock(run.to)}"
        ></span>
      {/each}
    </div>
    <div class="legend" aria-hidden="true">
      <span><i class="key battery"></i>Battery</span>
      <span><i class="key charging-key"></i>Charging</span>
      <span><i class="key cpu"></i>CPU</span>
      <span><i class="key memory"></i>Memory</span>
      <span><i class="key asleep"></i>Asleep</span>
      <span><i class="key off"></i>Off</span>
      <span><i class="key screen"></i>Screen off</span>
      <span><i class="key offline"></i>Offline</span>
    </div>
  </div>
</div>

<style>
  .device {
    --line: 32px;
    --strip: 14px;
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
  .battery {
    stroke: var(--success);
  }
  .cpu {
    stroke: var(--accent);
  }
  .memory {
    stroke: var(--muted-strong);
  }
  .charging {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--success) 16%, transparent);
  }
  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .asleep {
    background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 5px);
  }
  .off {
    background: var(--muted-strong);
  }
  .screen {
    background: color-mix(in srgb, var(--muted) 45%, transparent);
  }
  .offline {
    background: color-mix(in srgb, var(--danger) 45%, transparent);
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
  .key.battery {
    background: var(--success);
  }
  .key.charging-key {
    background: color-mix(in srgb, var(--success) 30%, transparent);
  }
  .key.cpu {
    background: var(--accent);
  }
  .key.memory {
    background: var(--muted-strong);
  }
</style>
