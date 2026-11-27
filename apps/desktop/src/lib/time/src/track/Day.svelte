<script lang="ts">
  import { localDate, midnightOf } from '../../../platform/src/api'
  import ActivityMark from '../ActivityMark.svelte'
  import Blocks from '../Blocks.svelte'
  import { daysAfter, stepped } from '../days'
  import { nameOf, tintOf } from '../look'
  import { watchedMinutes } from '../watched.svelte'
  import { swipes } from '../../../ui-kit/src/api'

  const {
    now,
    day,
    only = null,
    onday,
    onall,
    onmanage,
  }: {
    now: number
    day: number
    only?: string | null
    onday: (day: number) => void
    onall: () => void
    onmanage: () => void
  } = $props()
  const today = $derived(midnightOf(now))
  const to = $derived(daysAfter(day, 1))
  const minutes = watchedMinutes(() => [day, to])
  const dated = $derived(localDate(day, { weekday: 'short', day: 'numeric', month: 'short' }))
  function turn(by: -1 | 1) {
    const next = stepped('day', day, by)
    if (next <= today) onday(next)
  }
</script>

<header class="when">
  <button type="button" class="step" aria-label="Day before" data-track-before onclick={() => turn(-1)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
  </button>
  <button type="button" class="date" aria-label="{dated}, back to today" data-track-date onclick={() => onday(today)}
    >{day === today ? 'Today' : dated}</button
  >
  <button
    type="button"
    class="step"
    aria-label="Day after"
    data-track-after
    disabled={day >= today}
    onclick={() => turn(1)}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
  </button>
</header>
{#if only !== null}
  <button type="button" class="only" style:--tint={tintOf(only)} data-track-only onclick={onall}>
    <ActivityMark activity={only} size={20} />
    <span>{nameOf(only, 'Not set')}</span>
    <span class="all">Show all</span>
  </button>
{/if}
<div class="blocks" use:swipes={turn} data-track-day={day}>
  <Blocks from={day} {to} {now} minutes={minutes.list} untracked single phone {only} {onmanage} />
</div>

<style>
  .when {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .step,
  .date {
    min-height: var(--touch-row);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .step {
    width: var(--touch-row);
    display: grid;
    place-items: center;
  }
  .step:disabled {
    color: var(--line);
  }
  .step svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .date {
    flex: 1;
    font-size: 1.25rem;
    font-weight: 650;
  }
  .only {
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    border: none;
    border-radius: 14px;
    background: color-mix(in srgb, var(--tint) 14%, var(--surface));
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: start;
  }
  .only .all {
    margin-inline-start: auto;
    color: var(--muted);
    font-weight: 500;
  }
  .blocks {
    flex: 1;
    min-height: 0;
    touch-action: pan-y;
  }
</style>
