<script lang="ts">
  import { untrack } from 'svelte'
  import { localDate, midnightOf } from '../../platform/src/api'
  import { menu, segmented } from '../../ui-kit/src/api'
  import type { Tab } from '../../documents/src/api'
  import Activities from './Activities.svelte'
  import DayLanes from './DayLanes.svelte'
  import { daysAfter, endOf, startOf } from './days'
  import { hoursShown, type Picked } from './lanes'
  import { managing } from './manage.svelte'
  import Picker from './Picker.svelte'
  import Side from './Side.svelte'
  import { readSpec, type View, writeSpec } from './spec'
  import './start.svelte'
  import { time } from './time.svelte'
  import WeekGrid from './WeekGrid.svelte'
  import { ticking, watchedMinutes } from './watched.svelte'

  const { tab }: { tab: Tab } = $props()
  const me = crypto.randomUUID()
  const first = untrack(() => readSpec(tab.doc))
  let view = $state<View>(first.view)
  let chosen = $state<number | null>(null)
  let selected = $state<string | null>(null)
  let range = $state<Picked | null>(null)
  const ticker = ticking()
  const now = $derived(ticker.now)
  const day = $derived(chosen ?? midnightOf(now))
  $effect(() => {
    const text = writeSpec({ view })
    untrack(() => {
      if (text !== tab.doc) tab.note.replace(text, false)
    })
  })
  $effect(() => {
    void time.exchange()
  })
  const span = $derived.by((): [number, number] => {
    if (view === 'day') return [day, daysAfter(day, 1)]
    const from = startOf('week', day)
    return [from, endOf('week', from)]
  })
  const minutes = watchedMinutes(() => span)
  const shown = $derived(
    hoursShown(span[0], span[1], [
      ...time.spans
        .filter((one) => one.start < span[1] && (one.end ?? now) > span[0])
        .flatMap((one) => [one.start, one.end ?? now]),
      ...minutes.list.map((one) => one.at),
      now,
    ]),
  )
  const current = $derived(view === 'day' ? day === midnightOf(now) : startOf('week', now) === span[0])
  const titled = $derived(
    view === 'day'
      ? localDate(day, { weekday: 'long', day: 'numeric', month: 'long' })
      : `${localDate(span[0], { day: 'numeric', month: 'short' })} – ${localDate(daysAfter(span[1], -1), { day: 'numeric', month: 'short', year: 'numeric' })}`,
  )
  const manage = () => managing.open(me)
  function choose(one: number) {
    chosen = one === midnightOf(now) ? null : one
    selected = null
    range = null
  }
  function step(by: number) {
    choose(view === 'day' ? daysAfter(day, by) : daysAfter(startOf('week', day), 7 * by))
  }
  function showMenu(event: MouseEvent) {
    void import('./menu').then(({ trackingMenu }) => menu.show(event, trackingMenu(), { title: 'Time tracker' }))
  }
  const VIEWS = [
    ['day', 'Day'],
    ['week', 'Week'],
  ] as const
</script>

<div class="tab" data-time-tab>
  <div class="head">
    <Picker {now} wide onmanage={manage} />
  </div>

  <div class="bar">
    <div class="orden-segmented" role="radiogroup" aria-label="Time tracker" use:segmented>
      {#each VIEWS as [id, label] (id)}
        <button type="button" role="radio" aria-checked={view === id} class:on={view === id} onclick={() => (view = id)}
          >{label}</button
        >
      {/each}
    </div>
    <div class="moving">
      <button type="button" class="orden-chip is-quiet" aria-label="Previous" onclick={() => step(-1)}>‹</button>
      <span class="title">{titled}</span>
      <button type="button" class="orden-chip is-quiet" aria-label="Next" onclick={() => step(1)}>›</button>
      {#if !current}
        <button type="button" class="orden-chip" onclick={() => choose(midnightOf(now))}>Today</button>
      {/if}
    </div>
    <button type="button" class="orden-chip" onclick={manage}>Activities</button>
    <button
      type="button"
      class="orden-chip is-quiet"
      aria-label="More"
      title="More"
      aria-haspopup="menu"
      onclick={showMenu}>⋯</button
    >
  </div>

  <div class="body">
    {#if view === 'day'}
      <div class="day">
        <div class="lanes">
          <DayLanes
            from={shown[0]}
            to={shown[1]}
            minutes={minutes.list}
            {now}
            {selected}
            {range}
            onselect={(id: string | null) => {
              selected = id
              range = null
            }}
            onrange={(next: Picked | null) => {
              range = next
              selected = null
            }}
            onmanage={manage}
          />
        </div>
        <aside class="side">
          <Side
            {day}
            {now}
            minutes={minutes.list}
            {selected}
            {range}
            onselect={(id: string | null) => (selected = id)}
            onmanage={manage}
          />
        </aside>
      </div>
    {:else}
      <WeekGrid
        from={span[0]}
        minutes={minutes.list}
        {now}
        onpick={(one: number, id: string | null) => {
          choose(one)
          view = 'day'
          selected = id
        }}
      />
    {/if}
  </div>
</div>

<Activities open={managing.by === me} onclose={() => managing.close()} />

<style>
  .tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
    container-type: inline-size;
  }
  .head,
  .bar,
  .body {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--space-5);
  }
  .head {
    padding-top: var(--space-5);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding-top: var(--space-4);
    padding-bottom: var(--space-3);
  }
  .moving {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    padding: 0 var(--space-2);
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    padding-bottom: var(--space-6);
  }
  .day {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: var(--space-5);
    align-items: start;
  }
  .side {
    padding: var(--space-3) var(--space-2);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-2) 50%, transparent);
  }
  @container (max-width: 760px) {
    .day {
      grid-template-columns: minmax(0, 1fr);
    }
    .moving {
      flex-basis: 100%;
      order: 3;
    }
    .head,
    .bar,
    .body {
      padding-inline: var(--space-3);
    }
  }
  @container (max-width: 480px) {
    .head :global(.since) {
      display: none;
    }
  }
</style>
