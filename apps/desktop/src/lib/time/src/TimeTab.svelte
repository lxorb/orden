<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fly, localDate, midnightOf } from '../../platform/src/api'
  import { shortcuts } from '../../shortcuts/src/api'
  import { DateField } from '../../ui-controls/src/api'
  import { DIVIDER, hang, menu, overlays, segmented } from '../../ui-kit/src/api'
  import type { Tab } from '../../documents/src/api'
  import Activities from './Activities.svelte'
  import Blocks from './Blocks.svelte'
  import { daysAfter, endOf, startOf, stepped } from './days'
  import { undone } from './edit'
  import { length } from './look'
  import { managing } from './manage.svelte'
  import { dayOf } from '../../tasks-model/src/api'
  import NowCard from './NowCard.svelte'
  import { rangeTotals } from './schedule'
  import { type Kind, readSpec, writeSpec } from './spec'
  import './start.svelte'
  import Summary from './Summary.svelte'
  import { time } from './time.svelte'
  import Timeline from './Timeline.svelte'
  import { ticking, watchedMinutes } from './watched.svelte'

  const { tab }: { tab: Tab } = $props()
  const me = crypto.randomUUID()
  const first = untrack(() => readSpec(tab.doc))
  let kind = $state<Kind>(first.range)
  let custom = $state<[number, number] | null>(first.from !== null && first.to !== null ? [first.from, first.to] : null)
  let untracked = $state(first.untracked)
  let chosen = $state<number | null>(null)
  let timeline = $state(false)
  let customOpen = $state(false)
  let customChip = $state<HTMLElement | null>(null)
  let customLayer = $state<HTMLElement | null>(null)
  let draft = $state<[string, string]>(['', ''])
  const ticker = ticking()
  const now = $derived(ticker.now)
  const day = $derived(chosen ?? midnightOf(now))
  $effect(() => {
    const text = writeSpec({
      range: kind,
      from: kind === 'custom' ? (custom?.[0] ?? null) : null,
      to: kind === 'custom' ? (custom?.[1] ?? null) : null,
      untracked,
    })
    untrack(() => {
      if (text !== tab.doc) tab.note.replace(text, false)
    })
  })
  $effect(() => {
    void time.exchange()
  })
  const span = $derived.by((): [number, number] => {
    if (kind === 'day') return [day, daysAfter(day, 1)]
    if (kind === 'custom' && custom) return [custom[0], daysAfter(custom[1], 1)]
    const unit = kind === 'month' ? 'month' : 'week'
    const from = startOf(unit, day)
    return [from, endOf(unit, from)]
  })
  const minutes = watchedMinutes(() => span)
  const totals = $derived(rangeTotals(time.spans, minutes.list, span[0], span[1], now, { untracked }))
  const holdsToday = $derived(span[0] <= now && now < span[1])
  const short = (at: number) => localDate(at, { day: 'numeric', month: 'short' })
  const titled = $derived.by(() => {
    const last = daysAfter(span[1], -1)
    if (kind === 'day') return localDate(day, { weekday: 'long', day: 'numeric', month: 'long' })
    if (kind === 'month') return localDate(span[0], { month: 'long', year: 'numeric' })
    if (kind === 'custom') return `${short(span[0])} to ${short(last)}`
    const sameMonth = new Date(span[0]).getMonth() === new Date(last).getMonth()
    const end = sameMonth ? localDate(last, { day: 'numeric' }) : short(last)
    return `${short(span[0])} to ${end}, ${String(new Date(last).getFullYear())}`
  })
  const manage = () => managing.open(me)
  const iso = (at: number) => dayOf(at)
  const atIso = (text: string): number | null => {
    const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    return found ? new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3])).getTime() : null
  }
  function choose(one: number) {
    chosen = one === midnightOf(now) ? null : one
  }
  function step(by: number) {
    if (kind === 'day') choose(daysAfter(day, by))
    else if (kind === 'week') choose(daysAfter(startOf('week', day), 7 * by))
    else if (kind === 'month') choose(stepped('month', startOf('month', day), by))
    else if (custom) {
      const days = Math.round((daysAfter(custom[1], 1) - custom[0]) / 86_400_000)
      custom = [daysAfter(custom[0], days * by), daysAfter(custom[1], days * by)]
    }
  }
  function pick(next: Kind) {
    if (next === 'custom') {
      draft = [iso(custom?.[0] ?? span[0]), iso(custom?.[1] ?? daysAfter(span[1], -1))]
      customOpen = true
      return
    }
    kind = next
  }
  function apply() {
    const from = atIso(draft[0])
    const to = atIso(draft[1])
    if (from === null || to === null) return
    custom = from <= to ? [from, to] : [to, from]
    kind = 'custom'
    customOpen = false
  }
  $effect(() =>
    customOpen
      ? overlays.show(
          () => (customOpen = false),
          () => [customLayer, customChip],
        )
      : undefined,
  )
  function keyed(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return
    const redo = shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)
    if (!redo && !shortcuts.pressed('edit.undo', event)) return
    if (undone(redo)) event.preventDefault()
  }
  function showMenu(event: MouseEvent) {
    void import('./menu').then(({ trackingMenu }) =>
      menu.show(event, [{ label: 'Activities', run: manage }, DIVIDER, ...trackingMenu()], { title: 'Time tracker' }),
    )
  }
  const KINDS = [
    ['day', 'Day'],
    ['week', 'Week'],
    ['month', 'Month'],
    ['custom', 'Custom'],
  ] as const
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab" data-time-tab onkeydown={keyed}>
  <div class="page">
    <NowCard {now} onmanage={manage} />

    <div class="bar" data-time-range>
      <div class="orden-segmented" role="radiogroup" aria-label="Range" use:segmented>
        {#each KINDS as [id, label] (id)}
          {#if id === 'custom'}
            <button
              type="button"
              role="radio"
              aria-checked={kind === id}
              class:on={kind === id}
              bind:this={customChip}
              onclick={() => pick(id)}>{label}</button
            >
          {:else}
            <button
              type="button"
              role="radio"
              aria-checked={kind === id}
              class:on={kind === id}
              onclick={() => pick(id)}>{label}</button
            >
          {/if}
        {/each}
      </div>
      <div class="moving">
        <button type="button" class="orden-glyph step" aria-label="Previous" title="Previous" onclick={() => step(-1)}
          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button
        >
        <span class="title">{titled}</span>
        <button type="button" class="orden-glyph step" aria-label="Next" title="Next" onclick={() => step(1)}
          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button
        >
        {#if !holdsToday && kind !== 'custom'}
          <button type="button" class="orden-chip" onclick={() => (chosen = null)}>Today</button>
        {/if}
      </div>
      <div class="ends">
        <button
          type="button"
          class="orden-chip marked"
          aria-pressed={untracked}
          class:is-on={untracked}
          data-time-untracked
          onclick={() => (untracked = !untracked)}
        >
          <span class="dashed" aria-hidden="true"></span>Untracked
        </button>
        <button type="button" class="orden-chip marked" data-time-timeline-open onclick={() => (timeline = true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h12M4 10V6M7 10V3M10 10V7M13 10V5" /></svg>Timeline
        </button>
        <button
          type="button"
          class="orden-chip is-quiet"
          aria-label="More"
          title="More"
          aria-haspopup="menu"
          onclick={showMenu}>⋯</button
        >
      </div>
    </div>

    <div class="main">
      <aside class="left">
        <Summary
          from={span[0]}
          to={span[1]}
          {now}
          minutes={minutes.list}
          {totals}
          per={kind === 'day' ? 'day' : kind === 'week' ? 'week' : null}
        />
      </aside>
      <section class="right">
        <p class="orden-section">
          Schedule{#if kind === 'day'}<span>{length(totals.ms)}</span>{/if}
        </p>
        <Blocks
          from={span[0]}
          to={span[1]}
          {now}
          minutes={minutes.list}
          {untracked}
          single={kind === 'day'}
          onmanage={manage}
        />
      </section>
    </div>
  </div>
</div>

{#if customOpen && customChip}
  <div
    class="custom orden-layer"
    data-covers
    bind:this={customLayer}
    use:hang={{ side: 'below', gap: 6, from: customChip }}
    transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}
  >
    <span class="caption">From</span>
    <DateField label="From" value={draft[0]} onchange={(next: string) => (draft = [next, draft[1]])} />
    <span class="caption">To</span>
    <DateField label="To" value={draft[1]} onchange={(next: string) => (draft = [draft[0], next])} />
    <button type="button" class="orden-button" onclick={apply}>Apply</button>
  </div>
{/if}
{#if timeline}
  <Timeline start={daysAfter(span[1], -1)} {now} onclose={() => (timeline = false)} />
{/if}
<Activities open={managing.by === me} onclose={() => managing.close()} />

<style>
  .tab {
    container: time-tab / inline-size;
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-5);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .moving {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .step {
    border-radius: 50%;
  }
  .title {
    padding: 0 var(--space-1);
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ends {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .marked {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .marked svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .dashed {
    width: 10px;
    height: 10px;
    border: 1.5px dashed currentColor;
    border-radius: 2px;
  }
  .main {
    display: grid;
    grid-template-columns: 21.5rem minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .left {
    position: sticky;
    top: 0;
  }
  .right {
    min-width: 0;
  }
  .caption {
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }
  .custom {
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 16rem;
    padding: var(--space-3);
  }
  @container time-tab (max-width: 879px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
    }
    .left {
      position: static;
    }
    .moving {
      flex-basis: 100%;
      order: 3;
    }
    .page {
      padding: var(--space-3);
    }
  }
</style>
