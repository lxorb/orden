<script lang="ts">
  import { midnightOf } from '../../platform/src/api'
  import { TimeField } from '../../ui-controls/src/api'
  import { menu } from '../../ui-kit/src/api'
  import ActivityButton from './ActivityButton.svelte'
  import ActivityMark from './ActivityMark.svelte'
  import type { Place } from './counted'
  import { atClock, clockOf, daysAfter } from './days'
  import { activeIn, type Picked, within } from './lanes'
  import { clock, length, nameOf, placeTint } from './look'
  import type { Minute } from './minutes'
  import Pie from './Pie.svelte'
  import type { Lane } from './records'
  import { dayTotals, removeBlock, resizeBlock, setActivity } from './schedule'
  import { edited } from './edit'
  import { time } from './time.svelte'

  const {
    day,
    now,
    minutes,
    selected,
    range,
    onselect,
    onmanage,
  }: {
    day: number
    now: number
    minutes: readonly Minute[]
    selected: string | null
    range: Picked | null
    onselect: (id: string | null) => void
    onmanage: () => void
  } = $props()
  const LANES: readonly [Lane, string][] = [
    ['app', 'Apps'],
    ['site', 'Websites'],
    ['space', 'Spaces'],
    ['tab', 'Tabs'],
  ]
  const next = $derived(daysAfter(day, 1))
  const block = $derived(selected === null ? null : time.span(selected))
  const shown = $derived<Picked>(
    block ? { from: block.start, to: block.end ?? now } : (range ?? { from: day, to: next }),
  )
  const totals = $derived(dayTotals(time.spans, day, now))
  const active = $derived(activeIn(minutes, day, next))
  const found = $derived(within(time.spans, minutes, shown.from, shown.to, now))
  const groups = $derived(
    LANES.map(([lane, label]) => ({ lane, label, list: found.places[lane].slice(0, 5) })).filter(
      (one) => one.list.length,
    ),
  )
  function moved(which: 'start' | 'end', value: string) {
    const span = block
    if (!span) return
    const base = midnightOf(span.start)
    const at = atClock(base, value)
    if (at === null) return
    const end = which === 'end' && at <= span.start ? atClock(daysAfter(base, 1), value) : at
    if (end === null) return
    const writes =
      which === 'start'
        ? resizeBlock(time.spans, span.id, at, span.end ?? now, now)
        : resizeBlock(time.spans, span.id, span.start, end, now)
    edited(writes, 'moved')
  }
  function countAs(event: MouseEvent, lane: Lane, place: Place) {
    event.preventDefault()
    const was = time.ruleFor(lane, place.key)?.activity ?? null
    menu.show(
      event,
      [
        ...time.activities
          .filter((one) => !one.archived || one.id === was)
          .map((one) => ({
            label: one.name,
            checked: one.id === was,
            run: () => time.countAs(lane, place.key, one.id),
          })),
        null,
        { label: 'No activity', checked: was === null, run: () => time.countAs(lane, place.key, null) },
      ],
      { title: `Count as: ${place.name}` },
    )
  }
  const share = (ms: number) => (totals.ms > 0 ? Math.round((ms / totals.ms) * 100) : 0)
</script>

<div class="side" data-time-side>
  {#if block}
    <p class="head">
      <span>{clock(block.start)}–{block.end === null ? '' : clock(block.end)}</span>
      <span class="long">{length(shown.to - shown.from)}</span>
    </p>
    <div class="block">
      <ActivityButton
        value={block.activity}
        placeholder="Activity"
        onpick={(activity: string) => edited(setActivity(time.spans, block.id, activity), 'scheduled')}
        {onmanage}
      />
      <div class="clocks">
        <TimeField label="Start time" value={clockOf(block.start)} onchange={(next: string) => moved('start', next)} />
        <TimeField
          label="End time"
          value={block.end === null ? '' : clockOf(block.end)}
          disabled={block.end === null}
          onchange={(next: string) => moved('end', next)}
        />
      </div>
      <button
        type="button"
        class="orden-action is-danger"
        onclick={() => {
          edited(removeBlock(time.spans, block.id), 'deleted')
          onselect(null)
        }}>Delete</button
      >
    </div>
    <p class="orden-section">Active<span>{length(found.active)}</span></p>
  {:else if range}
    <p class="head">
      <span>{clock(range.from)}–{clock(range.to)}</span>
      <span class="long">{length(range.to - range.from)}</span>
    </p>
    <p class="orden-section">Active<span>{length(found.active)}</span></p>
  {:else}
    <Pie slices={totals.slices} ms={totals.ms} />
    <ul class="list">
      {#each totals.slices as slice (slice.activity)}
        <li class="orden-row is-short" data-slice={slice.activity ?? ''}>
          <ActivityMark activity={slice.activity} />
          <span class="orden-row-label" dir="auto">{nameOf(slice.activity, 'No activity')}</span>
          <span class="orden-row-meta">{length(slice.ms)}</span>
          <span class="orden-row-meta share">{share(slice.ms)}%</span>
        </li>
      {/each}
    </ul>
    <p class="orden-section active">Active<span data-time-active>{length(active)}</span></p>
  {/if}

  {#each groups as group (group.lane)}
    <p class="orden-section">{group.label}</p>
    <ul class="list">
      {#each group.list as place (place.key)}
        {@const rule = time.ruleFor(group.lane, place.key)}
        <li>
          <button
            type="button"
            class="orden-row is-short"
            title="Count as"
            onclick={(event) => countAs(event, group.lane, place)}
            oncontextmenu={(event) => countAs(event, group.lane, place)}
          >
            <span class="dot" style:background={placeTint(place.key)}></span>
            <span class="orden-row-label" dir="auto">{place.name}</span>
            {#if rule}<ActivityMark activity={rule.activity} size={12} />{/if}
            <span class="orden-row-meta">{length(place.ms)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/each}
</div>

<style>
  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    margin: 0 0 var(--space-2);
    padding: 0 var(--row-pad);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
  }
  .long {
    color: var(--muted);
    font-weight: var(--weight-row);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--row-pad);
  }
  .clocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list:first-of-type {
    margin-top: var(--space-3);
  }
  .share {
    flex: 0 0 2.6rem;
    text-align: end;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .active {
    margin-top: var(--space-2);
  }
</style>
