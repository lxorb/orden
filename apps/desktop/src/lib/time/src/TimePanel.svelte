<script lang="ts">
  import { midnightOf } from '../../platform/src/api'
  import Activities from './Activities.svelte'
  import { daysAfter } from './days'
  import { length } from './look'
  import { managing } from './manage.svelte'
  import NowCard from './NowCard.svelte'
  import { openTime } from './open'
  import { rangeTotals } from './schedule'
  import './start.svelte'
  import { time } from './time.svelte'
  import { ticking, watchedMinutes } from './watched.svelte'

  const me = crypto.randomUUID()
  const ticker = ticking()
  const now = $derived(ticker.now)
  const today = $derived(midnightOf(now))
  const tomorrow = $derived(daysAfter(today, 1))
  const minutes = watchedMinutes(() => [today, tomorrow])
  $effect(() => {
    void time.exchange()
  })
  const total = $derived(rangeTotals(time.spans, minutes.list, today, tomorrow, now, { untracked: false }).ms)
  function opened(event: MouseEvent) {
    const target = event.target as Element | null
    if (target?.closest('button, input, a, [role="option"], [role="listbox"]')) return
    openTime()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="time" data-time-panel ondblclick={opened}>
  <NowCard {now} compact onmanage={() => managing.open(me)} />
  <button type="button" class="orden-row is-short today" data-time-today onclick={() => openTime()}>
    <span class="orden-row-label">Today</span>
    <span class="orden-row-meta">{length(total)}</span>
    <svg class="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M4 2l3 3-3 3" /></svg>
  </button>
</div>

<Activities open={managing.by === me} onclose={() => managing.close()} />

<style>
  .time {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .chevron {
    flex: none;
    width: 9px;
    height: 9px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.6;
  }
</style>
