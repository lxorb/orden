<script lang="ts">
  import { overlays, segmented } from '../../ui-kit/src/api'
  import { menu } from '../../ui-kit/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { sensesDevice } from './machine'
  import { sensesHealth } from './health'
  import { watchedHealth } from './health-store.svelte'
  import type { Place } from './counted'
  import { activeIn, within } from './lanes'
  import { length, nameOf, placeTint, tintOf } from './look'
  import type { Minute } from './minutes'
  import Pie from './Pie.svelte'
  import { percent } from './percent.svelte'
  import PlaceIcon from './PlaceIcon.svelte'
  import { appName } from './places'
  import type { Lane, Per } from './records'
  import type { RangeTotals } from './schedule'
  import { time } from './time.svelte'

  const {
    from,
    to,
    now,
    minutes,
    totals,
    per,
    wide = false,
  }: {
    from: number
    to: number
    now: number
    minutes: readonly Minute[]
    totals: RangeTotals
    per: Per | null
    wide?: boolean
  } = $props()
  const LANES: readonly [Lane, string][] = [
    ['space', 'Spaces'],
    ['site', 'Websites'],
    ['tab', 'Tabs'],
    ['app', 'Apps'],
  ]
  const TOP = 5
  let lane = $state<Lane>('space')
  let lit = $state<string | null>(null)
  let card = $state<HTMLElement | null>(null)
  let pinned = $state(false)
  function hover(key: string | null) {
    if (!pinned) lit = key
  }
  function pin(key: string | null) {
    lit = key
    pinned = key !== null
  }
  $effect(() =>
    pinned
      ? overlays.show(
          () => pin(null),
          () => [card],
        )
      : undefined,
  )
  let all = $state<Lane | null>(null)
  const health = watchedHealth(() => [from, to])
  const active = $derived(activeIn(minutes, from, to))
  const found = $derived(within(time.spans, minutes, from, to, now))
  const groups = $derived(LANES.map(([key, label]) => ({ lane: key, label, list: found.places[key] })))
  const part = (ms: number, of: number) => `${of > 0 ? Math.round((ms / of) * 100) : 0}%`
  const goalOf = (activity: string | null) => (activity === null || per === null ? null : time.goalFor(activity, per))
  function countAs(event: MouseEvent, kind: Lane, place: Place) {
    event.preventDefault()
    const was = time.ruleFor(kind, place.key)?.activity ?? null
    menu.show(
      event,
      [
        ...time.activities
          .filter((one) => !one.archived || one.id === was)
          .map((one) => ({
            label: one.name,
            checked: one.id === was,
            run: () => time.countAs(kind, place.key, one.id),
          })),
        null,
        { label: 'No activity', checked: was === null, run: () => time.countAs(kind, place.key, null) },
      ],
      { title: `Count as: ${place.name}` },
    )
  }
</script>

<div class="summary" class:wide>
  <section class="card totals" data-time-summary bind:this={card}>
    <div class="tools">
      <button
        type="button"
        class="orden-chip"
        class:is-on={percent.on}
        aria-pressed={percent.on}
        data-time-percent
        onclick={() => percent.set(!percent.on)}>Show percent</button
      >
    </div>
    <Pie
      slices={totals.slices}
      ms={totals.ms}
      tracked={totals.untracked > 0 ? totals.ms - totals.untracked : null}
      {lit}
      onlight={hover}
      onpin={pin}
    />
    {#if totals.slices.length}
      <ul class="legend">
        {#each totals.slices as slice (slice.activity)}
          {@const goal = goalOf(slice.activity)}
          <li>
            <button
              type="button"
              class="orden-row is-short slice"
              class:unset={slice.activity === null}
              class:is-on={lit === (slice.activity ?? '')}
              class:dim={lit !== null && lit !== (slice.activity ?? '')}
              data-slice={slice.activity ?? ''}
              onmouseenter={() => hover(slice.activity ?? '')}
              onmouseleave={() => hover(null)}
              onfocus={() => hover(slice.activity ?? '')}
              onblur={() => hover(null)}
              onclick={() => pin(pinned && lit === (slice.activity ?? '') ? null : (slice.activity ?? ''))}
            >
              {#if slice.activity === null}
                <span class="hatch" aria-hidden="true"></span>
              {:else}
                <ActivityMark activity={slice.activity} />
              {/if}
              <span class="orden-row-label named">
                <span class="name" dir="auto">{nameOf(slice.activity, 'Not set')}</span>
                {#if goal}
                  <span class="goal"
                    ><span style:width="{Math.min(1, slice.ms / goal.ms) * 100}%" style:--tint={tintOf(slice.activity)}
                    ></span></span
                  >
                {/if}
              </span>
              <span class="orden-row-meta" data-time-value
                >{percent.on
                  ? part(slice.ms, totals.ms)
                  : `${length(slice.ms)}${goal ? ` of ${length(goal.ms)}` : ''}`}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="active"><span>Active</span><span data-time-active>{length(active)}</span></p>
  </section>

  <section class="card places" data-time-places>
    <div class="orden-segmented switch" role="radiogroup" aria-label="Places" use:segmented>
      {#each groups as group (group.lane)}
        <button
          type="button"
          role="radio"
          aria-checked={lane === group.lane}
          class:on={lane === group.lane}
          onclick={() => (lane = group.lane)}>{group.label}</button
        >
      {/each}
    </div>
    {#each groups as group (group.lane)}
      {@const most = group.list[0]?.ms ?? 1}
      {@const whole = group.list.reduce((sum, one) => sum + one.ms, 0)}
      <div class="group" class:picked={lane === group.lane} data-time-lane={group.lane}>
        <p class="orden-section">{group.label}</p>
        {#if !group.list.length}
          <p class="none">Nothing yet</p>
        {/if}
        <ul>
          {#each all === group.lane ? group.list : group.list.slice(0, TOP) as place (place.key)}
            {@const rule = time.ruleFor(group.lane, place.key)}
            <li>
              <button
                type="button"
                class="orden-row is-short place"
                style:--tint={placeTint(place.key)}
                style:--part={place.ms / most}
                title="Count as"
                onclick={(event) => countAs(event, group.lane, place)}
                oncontextmenu={(event) => countAs(event, group.lane, place)}
              >
                <PlaceIcon lane={group.lane} place={place.key} name={place.name} />
                <span class="orden-row-label named">
                  <span class="name" dir="auto"
                    >{group.lane === 'app' ? appName(place.key, place.name) : place.name}</span
                  >
                </span>
                {#if rule}<ActivityMark activity={rule.activity} size={12} />{/if}
                <span class="orden-row-meta spent" data-time-spent
                  >{percent.on ? part(place.ms, whole) : length(place.ms)}</span
                >
              </button>
            </li>
          {/each}
        </ul>
        {#if group.list.length > TOP}
          <button type="button" class="orden-action more" onclick={() => (all = all === group.lane ? null : group.lane)}
            >{all === group.lane ? 'Show less' : 'Show all'}</button
          >
        {/if}
      </div>
    {/each}
  </section>
  {#if sensesHealth(health.readings, health.workouts)}
    {#await import('./HealthCard.svelte') then { default: HealthCard }}
      <HealthCard {from} {to} readings={health.readings} workouts={health.workouts} />
    {/await}
  {/if}
  {#if sensesDevice(minutes)}
    {#await import('./DeviceCard.svelte') then { default: DeviceCard }}
      <DeviceCard {from} {to} {minutes} />
    {/await}
  {/if}
</div>

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .tools {
    display: flex;
    justify-content: flex-end;
    margin: calc(var(--space-1) * -1) 0 var(--space-2);
  }
  .card {
    min-width: 0;
    padding: var(--space-4) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .slice {
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  .slice.dim {
    opacity: 0.45;
  }
  .legend {
    margin-top: var(--space-4);
  }
  .named {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .goal {
    display: block;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
    background: var(--surface-2);
  }
  .goal span {
    display: block;
    height: 100%;
    background: var(--tint);
  }
  @media (forced-colors: active) {
    .goal span {
      background: Highlight;
    }
    .place {
      background: none;
    }
  }
  .place {
    --spent: 4.25rem;
    --lead: calc(var(--row-pad) + 16px + var(--row-gap));
    --room: calc(100% - var(--lead) - var(--spent) - var(--space-1));
    --bar: color-mix(in srgb, var(--tint) 14%, transparent);
    background: linear-gradient(var(--bar), var(--bar)) no-repeat 0 0 / calc(var(--lead) + var(--room) * var(--part))
      100%;
  }
  .spent {
    flex: 0 0 var(--spent);
    text-align: end;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .unset .name {
    color: var(--muted-strong);
  }
  .hatch {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px);
    opacity: 0.8;
  }
  .active {
    display: flex;
    justify-content: space-between;
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--row-pad) 0;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .active span:first-child {
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .switch {
    display: none;
    margin-bottom: var(--space-2);
  }
  .group + .group {
    margin-top: var(--space-2);
  }
  .none {
    margin: 0;
    padding: 0 var(--row-pad);
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .more {
    padding-inline: var(--row-pad);
    min-height: 26px;
    font-size: var(--text-xs);
  }
  @container time-tab (min-width: 880px) {
    .summary.wide {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
  }
  @container time-tab (max-width: 879px) {
    .switch {
      display: flex;
    }
    .group:not(.picked) {
      display: none;
    }
    .group .orden-section {
      display: none;
    }
  }
</style>
