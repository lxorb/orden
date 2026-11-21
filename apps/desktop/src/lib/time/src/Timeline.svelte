<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, fly, localDate, midnightOf } from '../../platform/src/api'
  import { trap } from '../../ui-controls/src/api'
  import { closeOnBack, Cross, overlays } from '../../ui-kit/src/api'
  import DayLanes from './DayLanes.svelte'
  import { sensesDevice } from './machine'
  import { sensesHealth } from './health'
  import { watchedHealth } from './health-store.svelte'
  import { daysAfter } from './days'
  import { hoursShown } from './lanes'
  import { time } from './time.svelte'
  import { watchedMinutes } from './watched.svelte'

  const { start, now, onclose }: { start: number; now: number; onclose: () => void } = $props()
  let day = $state(midnightOf(Math.min(start, Date.now())))
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
  $effect(() => overlays.show(onclose))
  $effect(() => closeOnBack(true, onclose))
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="orden-scrim scrim" transition:fade={{ duration: dur(160) }} onclick={onclose}></div>
<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-label="Timeline"
  data-covers
  data-time-timeline
  use:trap
  transition:fly={{ x: 24, duration: dur(200), easing: cubicOut }}
>
  <div class="head">
    <h2>Timeline</h2>
    <div class="moving">
      <button
        type="button"
        class="orden-chip is-quiet"
        aria-label="Previous day"
        onclick={() => (day = daysAfter(day, -1))}>‹</button
      >
      <span class="title">{localDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <button
        type="button"
        class="orden-chip is-quiet"
        aria-label="Next day"
        disabled={next > now}
        onclick={() => (day = daysAfter(day, 1))}>›</button
      >
    </div>
    <button class="orden-glyph" aria-label="Close" title="Close" onclick={onclose}><Cross /></button>
  </div>
  <div class="body">
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
  </div>
</div>

<style>
  .scrim {
    z-index: var(--z-sheet);
  }
  .sheet {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    z-index: var(--z-sheet);
    max-height: calc(100dvh - 2 * var(--space-3));
    display: flex;
    flex-direction: column;
    width: min(44rem, calc(100vw - 2 * var(--space-3)));
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
  }
  h2 {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-base, 1rem);
    font-weight: var(--weight-strong);
  }
  .moving {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    overflow: hidden;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 var(--space-4) var(--space-4);
  }
  @media (max-width: 879px) {
    .sheet {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      max-height: calc(100dvh - var(--space-6));
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
  }
</style>
