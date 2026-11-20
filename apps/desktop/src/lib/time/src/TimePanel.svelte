<script lang="ts">
  import { midnightOf } from '../../platform/src/api'
  import Activities from './Activities.svelte'
  import ActivityMark from './ActivityMark.svelte'
  import { isOwn } from './counted'
  import { daysAfter, piecesIn } from './days'
  import { activeIn, hoursShown } from './lanes'
  import { length } from './look'
  import { managing } from './manage.svelte'
  import { openTime } from './open'
  import Picker from './Picker.svelte'
  import { dayTotals } from './schedule'
  import './start.svelte'
  import Strip from './Strip.svelte'
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
  const shown = $derived(
    hoursShown(
      today,
      tomorrow,
      [...piecesIn(time.spans, today, tomorrow, now, isOwn).flatMap((one) => [one.from, one.to]), now],
      [9, 17],
    ),
  )
  const totals = $derived(dayTotals(time.spans, today, now))
  const active = $derived(activeIn(minutes.list, today, tomorrow))
  const recent = $derived(time.latest().slice(0, 5))
  const todayOf = (activity: string) => totals.slices.find((one) => one.activity === activity)?.ms ?? 0
  const manage = () => managing.open(me)
  function opened(event: MouseEvent) {
    const target = event.target as Element | null
    if (target?.closest('button, input, a, [role="option"], [role="listbox"]')) return
    openTime()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="time" ondblclick={opened}>
  <Picker {now} onmanage={manage} />

  {#if recent.length}
    <p class="orden-section">Recent</p>
    <ul>
      {#each recent as one (one.id)}
        {@const on = time.running.some((span) => span.activity === one.id)}
        <li>
          <button
            type="button"
            class="orden-row is-short"
            class:is-on={on}
            title="Start timer"
            data-activity={one.id}
            onclick={() => {
              if (!on) time.start(one.id)
            }}
          >
            <ActivityMark activity={one.id} />
            <span class="orden-row-label" dir="auto">{one.name}</span>
            <span class="orden-row-meta">{todayOf(one.id) ? length(todayOf(one.id)) : ''}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="orden-section">Today<span data-time-today>{length(totals.ms)}</span></p>
  <div class="today">
    <Strip from={shown[0]} to={shown[1]} spans={time.spans} {now} />
    <p class="active">Active<span data-time-active>{length(active)}</span></p>
  </div>

  <button type="button" class="orden-row is-short is-quiet open" onclick={() => openTime()}>Open time tracker</button>
</div>

<Activities open={managing.by === me} onclose={() => managing.close()} />

<style>
  .time {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-1);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .today {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--row-pad);
  }
  .active {
    display: flex;
    justify-content: space-between;
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .open {
    margin-top: var(--space-2);
    color: var(--muted);
  }
</style>
