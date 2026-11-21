<script lang="ts">
  import { deviceSum } from './machine'
  import { length } from './look'
  import type { Minute } from './minutes'

  const { from, to, minutes }: { from: number; to: number; minutes: readonly Minute[] } = $props()
  const sum = $derived(deviceSum(minutes, from, to))
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const rows = $derived(
    [
      sum.battery
        ? [
            'Battery',
            percent(sum.battery.now),
            sum.battery.low < sum.battery.high ? `${percent(sum.battery.low)} to ${percent(sum.battery.high)}` : '',
          ]
        : null,
      sum.onBattery ? ['On battery', length(sum.onBattery), ''] : null,
      sum.charging ? ['Charging', length(sum.charging), ''] : null,
      sum.cpu ? ['CPU', percent(sum.cpu.mean), `peak ${percent(sum.cpu.peak)}`] : null,
      sum.memory ? ['Memory', percent(sum.memory.mean), `peak ${percent(sum.memory.peak)}`] : null,
      sum.asleep ? ['Asleep', length(sum.asleep), ''] : null,
      sum.off ? ['Off', length(sum.off), ''] : null,
      sum.screenOff ? ['Screen off', length(sum.screenOff), ''] : null,
      sum.offline ? ['Offline', length(sum.offline), ''] : null,
    ].filter((one): one is string[] => one !== null),
  )
</script>

{#if rows.length}
  <section class="card device" data-time-device-card>
    <p class="orden-section">This device</p>
    <ul>
      {#each rows as [name, value, more] (name)}
        <li class="orden-row is-short" data-device-row={name}>
          <span class="orden-row-label">{name}</span>
          {#if more}<span class="orden-row-meta more">{more}</span>{/if}
          <span class="orden-row-meta value">{value}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .card {
    min-width: 0;
    padding: var(--space-4) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .orden-section {
    margin: 0 0 var(--space-1);
    padding: 0 var(--row-pad);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .value {
    flex: 0 0 4.25rem;
    text-align: end;
  }
  .more {
    color: var(--muted);
  }
</style>
