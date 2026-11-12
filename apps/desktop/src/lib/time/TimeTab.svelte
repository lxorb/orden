<script lang="ts">
  import { untrack } from 'svelte'
  import { localDate } from '../region'
  import { menu } from '../menu.svelte'
  import { segmented } from '../slide'
  import type { Tab } from '../workspace/documents.svelte'
  import { counted, isOwn } from './counted'
  import DayLanes from './DayLanes.svelte'
  import { counts, dayOf, daysAfter, endOf, piecesIn, startOf, stepped } from './days'
  import Inside from './Inside.svelte'
  import { hoursShown, type Picked, unsaid } from './lanes'
  import { clock, length, nameOf, tintOf } from './look'
  import Reports from './Reports.svelte'
  import { readSpec, type View, writeSpec } from './spec'
  import './start.svelte'
  import { time } from './time.svelte'
  import Timer from './Timer.svelte'
  import WeekGrid from './WeekGrid.svelte'
  import { ticking, watchedMinutes } from './watched.svelte'

  const { tab }: { tab: Tab } = $props()

  const first = untrack(() => readSpec(tab.doc))
  let view = $state<View>(first.view)
  let day = $state(dayOf(first.day ?? Date.now()))
  let period = $state<'week' | 'month'>('week')
  let picked = $state<Picked | null>(null)

  const ticker = ticking()
  const now = $derived(ticker.now)

  $effect(() => {
    const text = writeSpec({ view, day })
    untrack(() => {
      if (text !== tab.doc) tab.note.replace(text, false)
    })
  })

  $effect(() => {
    void time.exchange()
  })

  const range = $derived.by((): [number, number] => {
    if (view === 'day') return [day, daysAfter(day, 1)]
    const unit = view === 'week' ? 'week' : period
    const from = startOf(unit, day)
    return [from, endOf(unit, from)]
  })
  const minutes = watchedMinutes(() => range)
  const own = $derived(counted(time.spans, time.rules))
  const said = $derived(time.spans.filter(isOwn))

  const shown = $derived(
    hoursShown(range[0], range[1], [
      ...piecesIn(time.spans, range[0], range[1], now).flatMap((one) => [one.from, one.to]),
      ...minutes.list.map((one) => one.at),
      now,
    ]),
  )
  const entries = $derived(
    piecesIn(said, range[0], range[1], now)
      .filter((one) => one.span.end === null || counts(one.to - one.from))
      .sort((one, other) => other.from - one.from),
  )

  const loose = $derived(view === 'day' ? unsaid(time.spans, minutes.list, ...range, now) : [])
  const current = $derived(
    view === 'day'
      ? day === dayOf(now)
      : startOf(view === 'week' ? 'week' : period, now) === range[0],
  )

  const titled = $derived.by(() => {
    if (view === 'day') return localDate(day, { weekday: 'long', day: 'numeric', month: 'long' })
    if (view === 'reports' && period === 'month')
      return localDate(range[0], { month: 'long', year: 'numeric' })
    return `${localDate(range[0], { day: 'numeric', month: 'short' })} – ${localDate(daysAfter(range[1], -1), { day: 'numeric', month: 'short', year: 'numeric' })}`
  })

  function step(by: number) {
    picked = null
    if (view === 'day') day = daysAfter(day, by)
    else if (view === 'week' || period === 'week') day = daysAfter(startOf('week', day), 7 * by)
    else day = stepped('month', startOf('month', day), by)
  }

  function toDay(one: number) {
    day = one
    view = 'day'
    picked = null
  }

  function showMenu(event: MouseEvent) {
    void import('./menu').then(({ trackingMenu }) =>
      menu.show(event, trackingMenu(), { title: 'Time tracker' }),
    )
  }

  const VIEWS = $derived([
    ['day', 'Day'],
    ['week', 'Week'],
    ['reports', 'Reports'],
  ] as const)
</script>

<div class="tab">
  <div class="head">
    <div class="timer"><Timer {now} wide /></div>
  </div>

  <div class="bar">
    <div class="orden-segmented" role="radiogroup" aria-label="Time tracker" use:segmented>
      {#each VIEWS as [id, label] (id)}
        <button
          type="button"
          role="radio"
          aria-checked={view === id}
          class:on={view === id}
          onclick={() => {
            view = id
            picked = null
          }}>{label}</button
        >
      {/each}
    </div>
    {#if view === 'reports'}
      <div class="orden-segmented" role="radiogroup" aria-label="Reports" use:segmented>
        {#each [['week', 'Week'], ['month', 'Month']] as const as [id, label] (id)}
          <button
            type="button"
            role="radio"
            aria-checked={period === id}
            class:on={period === id}
            onclick={() => (period = id)}>{label}</button
          >
        {/each}
      </div>
    {/if}
    <div class="moving">
      <button type="button" class="orden-chip" aria-label="Previous" onclick={() => step(-1)}
        >‹</button
      >
      <span class="title">{titled}</span>
      <button type="button" class="orden-chip" aria-label="Next" onclick={() => step(1)}>›</button>
      {#if !current}
        <button
          type="button"
          class="orden-chip"
          onclick={() => {
            day = dayOf(Date.now())
            picked = null
          }}>Today</button
        >
      {/if}
    </div>
    <button
      type="button"
      class="orden-chip more"
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
            spans={time.spans}
            own={said}
            minutes={minutes.list}
            {now}
            {picked}
            onpick={(next: Picked | null) => (picked = next)}
          />
          <p class="hint">Drag across the day to see what happened in that time.</p>
          {#if entries.length}
            <ul class="entries">
              {#each entries as piece (piece.span.id)}
                <li>
                  <button
                    type="button"
                    class="orden-row"
                    class:is-on={picked?.span === piece.span.id}
                    onclick={() =>
                      (picked = {
                        from: piece.span.start,
                        to: piece.span.end ?? now,
                        span: piece.span.id,
                      })}
                  >
                    <span class="dot" style:background={tintOf(piece.span.activity)}></span>
                    <span class="orden-row-label named"
                      ><span class="name" dir="auto"
                        >{nameOf(piece.span.activity, 'No activity')}</span
                      >{#if piece.span.note}<span class="note" dir="auto">{piece.span.note}</span
                        >{/if}</span
                    >
                    <span class="orden-row-meta clock"
                      >{clock(piece.span.start)}–{piece.span.end === null
                        ? ''
                        : clock(piece.span.end)}</span
                    >
                    <span class="orden-row-meta long">{length(piece.to - piece.from)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <aside class="side">
          {#if picked}
            <Inside
              {picked}
              onpick={(next: Picked | null) => (picked = next)}
              spans={time.spans}
              minutes={minutes.list}
              {now}
              {loose}
            />
          {:else}
            <Inside
              picked={{ from: range[0], to: range[1], span: null }}
              title={localDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}
              spans={time.spans}
              minutes={minutes.list}
              {now}
              {loose}
              whole
              onpick={(next: Picked | null) => (picked = next)}
            />
          {/if}
        </aside>
      </div>
    {:else if view === 'week'}
      <WeekGrid
        from={range[0]}
        {said}
        minutes={minutes.list}
        {now}
        onpick={(one: number, span: string | null) => {
          toDay(one)
          const entry = span ? time.span(span) : null
          if (entry) picked = { from: entry.start, to: entry.end ?? now, span: entry.id }
        }}
      />
    {:else}
      <Reports
        from={range[0]}
        to={range[1]}
        spans={time.spans}
        {own}
        minutes={minutes.list}
        {now}
        onday={toDay}
      />
    {/if}
  </div>
</div>

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
    grid-template-columns: minmax(0, 1fr) 18rem;
    gap: var(--space-5);
    align-items: start;
  }

  .hint {
    margin: var(--space-3) 0 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .entries {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .named {
    display: flex;
    gap: var(--space-2);
  }

  .named > * {
    min-width: 0;
    overflow: hidden;
    text-align: -webkit-match-parent;
    text-align: match-parent;
    text-overflow: ellipsis;
  }

  .note {
    color: var(--muted);
  }

  .clock,
  .long {
    font-variant-numeric: tabular-nums;
  }

  .long {
    flex: 0 0 4.5rem;
    text-align: end;
  }

  .side {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-2) 60%, transparent);
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
</style>
