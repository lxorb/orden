<script lang="ts">
  import DayLanes from './DayLanes.svelte'
  import { sensesDevice } from './machine'
  import { sensesHealth } from './health'
  import { watchedHealth } from './health-store.svelte'
  import { daysAfter } from './days'
  import { hoursShown } from './lanes'
  import { time } from './time.svelte'
  import { watchedMinutes } from './watched.svelte'

  const { day, now }: { day: number; now: number } = $props()
  const next = $derived(daysAfter(day, 1))
  const minutes = watchedMinutes(() => [day, next])
  const health = watchedHealth(() => [day, next])
  const shown = $derived(
    hoursShown(day, next, [
      ...time.spans
        .filter((one) => one.start < next && (one.end ?? now) > day)
        .flatMap((one) => [one.start, one.end ?? now]),
      ...minutes.list.map((one) => one.at),
      ...health.readings.filter((one) => one.kind === 'sleep').map((one) => one.at),
      ...(now >= day && now < next ? [now] : []),
    ]),
  )
</script>

<section class="timeline" aria-label="Timeline" data-time-timeline>
  <DayLanes from={shown[0]} to={shown[1]} minutes={minutes.list} {now} />
  {#if sensesHealth(health.readings, health.workouts)}
    {#await import('./HealthLanes.svelte') then { default: HealthLanes }}
      <HealthLanes from={shown[0]} to={shown[1]} readings={health.readings} workouts={health.workouts} />
    {/await}
  {/if}
  {#if sensesDevice(minutes.list)}
    {#await import('./DeviceLanes.svelte') then { default: DeviceLanes }}
      <DeviceLanes from={shown[0]} to={shown[1]} minutes={minutes.list} />
    {/await}
  {/if}
</section>

<style>
  .timeline {
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  @container time-tab (max-width: 879px) {
    .timeline {
      padding: var(--space-3);
    }
  }
</style>
