<script lang="ts">
  import Facts from '../Facts.svelte'
  import { counted, isOwn } from './counted'
  import { dayOf, daysAfter, MINUTE, near, piecesIn, totalsOf, wholeOf } from './days'
  import { hoursShown } from './lanes'
  import { length, tintOf } from './look'
  import { openTime } from './open'
  import './start.svelte'
  import Strip from './Strip.svelte'
  import { time } from './time.svelte'
  import Timer from './Timer.svelte'
  import { ticking, watchedMinutes } from './watched.svelte'

  const ticker = ticking()
  const now = $derived(ticker.now)
  const today = $derived(dayOf(now))
  const tomorrow = $derived(daysAfter(today, 1))
  const minutes = watchedMinutes(() => [today, tomorrow])

  $effect(() => {
    void time.exchange()
  })

  const own = $derived(counted(time.spans, time.rules))
  const shown = $derived(
    hoursShown(
      today,
      tomorrow,
      [
        ...piecesIn(time.spans, today, tomorrow, now).flatMap((one) => [one.from, one.to]),
        ...minutes.list.map((one) => one.at),
        now,
      ],
      [9, 17],
    ),
  )
  const pieces = $derived(piecesIn(own, today, tomorrow, now))
  const totals = $derived(totalsOf(pieces))
  const whole = $derived(wholeOf(pieces))
  const recent = $derived(time.latest().slice(0, 5))
  const empty = $derived(!time.activities.length && !time.spans.some(isOwn))
  const starters = $derived(['Work', 'Study', 'Reading', 'Break'])

  const inFront = $derived.by(() => {
    const fresh = near(time.spans, now - 2 * MINUTE, Infinity).filter(
      (one) => !isOwn(one) && one.end !== null && now - one.end < 2 * MINUTE,
    )
    const of = (lane: string) =>
      [...fresh].reverse().find((one) => one.source === lane)?.label ?? null
    return [of('app'), of('site') ?? of('tab')].filter((one) => one !== null)
  })

  const todayOf = (activity: string) => totals.find((one) => one.activity === activity)?.ms ?? 0

  function opened(event: MouseEvent) {
    const target = event.target as Element | null
    if (target?.closest('button, input, a, [role="option"]')) return
    openTime()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="time" ondblclick={opened}>
  <Timer {now} />

  {#if inFront.length && time.recording}
    <p class="front">
      <span class="live" aria-hidden="true"></span><span class="name" dir="auto"
        ><Facts line parts={inFront} /></span
      >
    </p>
  {/if}

  {#if empty}
    <p class="hello">
      Nothing recorded yet. Say what you are working on and press Start, or begin with one of these.
    </p>
    <div class="starters">
      {#each starters as name (name)}
        <button type="button" class="orden-chip" onclick={() => time.startNamed(name)}
          >{name}</button
        >
      {/each}
    </div>
  {:else}
    <p class="orden-section">Recent</p>
    <ul>
      {#each recent as one (one.id)}
        {@const on = time.running.some((span) => span.activity === one.id)}
        <li class:on>
          <button
            type="button"
            class="orden-row is-short"
            class:is-on={on}
            title="Start timer"
            onclick={() => time.start(one.id)}
          >
            <span class="dot" style:background={tintOf(one.id)}></span>
            <span class="orden-row-label" dir="auto">{one.name}</span>
            <span class="orden-row-meta">{todayOf(one.id) ? length(todayOf(one.id)) : ''}</span>
            <svg class="play" viewBox="0 0 12 12" aria-hidden="true"
              ><path d="M3.5 2.2v7.6L9.8 6z" /></svg
            >
          </button>
        </li>
      {/each}
    </ul>

    <p class="orden-section">Today<span>{length(whole)}</span></p>
    <div class="today">
      <Strip from={shown[0]} to={shown[1]} spans={own} minutes={minutes.list} {now} hours />
    </div>
  {/if}

  <button type="button" class="orden-button is-quiet open" onclick={() => openTime()}
    >Open time tracker</button
  >
</div>

<style>
  .time {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .front {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-2);
    overflow: hidden;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .front .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
  }

  .hello {
    margin: var(--space-2) var(--space-2) 0;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: 0 var(--space-2);
  }

  .play {
    flex: none;
    width: 10px;
    height: 10px;
    fill: currentColor;
    opacity: 0;
  }

  li:hover .play,
  li:focus-within .play,
  li.on .play {
    opacity: 0.7;
  }

  .today {
    padding: 0 var(--space-2);
  }

  .open {
    align-self: stretch;
    margin-top: var(--space-1);
    border: 1px solid var(--line-strong);
  }
</style>
