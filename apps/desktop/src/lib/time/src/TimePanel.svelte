<script lang="ts">
  import { midnightOf } from '../../platform/src/api'
  import { DIVIDER, menu } from '../../ui-kit/src/api'
  import ActivityFind from './ActivityFind.svelte'
  import ActivityLayer from './ActivityLayer.svelte'
  import ActivityMark from './ActivityMark.svelte'
  import Activities from './Activities.svelte'
  import { daysAfter, ticking as tickingText } from './days'
  import { clock, length, nameOf, tintOf } from './look'
  import { managing } from './manage.svelte'
  import { openTime } from './open'
  import { rangeTotals } from './schedule'
  import SideDay from './SideDay.svelte'
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
  const running = $derived(time.running[0] ?? null)
  const total = $derived(rangeTotals(time.spans, minutes.list, today, tomorrow, now, { untracked: false }).ms)
  const manage = () => managing.open(me)
  let switching = $state<HTMLElement | null>(null)
  let nameButton = $state<HTMLElement | null>(null)
  function showMenu(event: MouseEvent) {
    void import('./menu').then(({ trackingMenu }) =>
      menu.show(event, [{ label: 'Activities', run: manage }, DIVIDER, ...trackingMenu()], { title: 'Time tracker' }),
    )
  }
</script>

<div class="time" data-time-panel>
  <div class="bar">
    <button type="button" class="orden-chip" data-time-open onclick={() => openTime()}>Open</button>
    <button
      type="button"
      class="orden-chip is-quiet"
      aria-label="More"
      title="More"
      aria-haspopup="menu"
      onclick={showMenu}>⋯</button
    >
  </div>

  {#if running}
    <div class="current" style:--tint={tintOf(running.activity)} data-time-current>
      <span class="tile"><ActivityMark activity={running.activity} size={18} /></span>
      <div class="what">
        <button
          type="button"
          class="name"
          aria-haspopup="listbox"
          aria-expanded={switching !== null}
          title="Change activity"
          bind:this={nameButton}
          onclick={() => (switching = switching ? null : nameButton)}>{nameOf(running.activity, 'Not set')}</button
        >
        <span class="since">Since {clock(running.start)}</span>
      </div>
      <span class="tick" role="timer">{tickingText(now - running.start)}</span>
      <button
        type="button"
        class="orden-glyph stop"
        aria-label="Stop timer"
        title="Stop timer"
        data-time-stop
        onclick={() => time.stop()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /></svg>
      </button>
    </div>
  {:else}
    <div class="start" role="listbox" aria-label="Start an activity" data-time-start>
      <ActivityFind
        placeholder="Start an activity"
        limit={5}
        recent="Recent"
        focus={false}
        onpick={(id: string) => time.start(id)}
        onescape={() => undefined}
      />
    </div>
  {/if}

  <section class="today" aria-label="Today">
    <p class="orden-section">Today<span>{length(total)}</span></p>
    <SideDay from={today} to={tomorrow} {now} minutes={minutes.list} onmanage={manage} />
  </section>
</div>

{#if switching && running}
  <ActivityLayer
    from={switching}
    chosen={running.activity}
    onpick={(id: string) => {
      if (id !== running.activity) time.start(id)
    }}
    onmanage={manage}
    onclose={() => (switching = null)}
  />
{/if}
<Activities open={managing.by === me} onclose={() => managing.close()} />

<style>
  .time {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .current {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--tint) 35%, var(--line));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--tint) 9%, var(--surface));
    box-shadow: var(--shadow-sm);
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--tint) 20%, transparent);
  }
  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }
  .name {
    max-width: 100%;
    padding: 0;
    overflow: hidden;
    border: none;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }
  @media (hover: hover) {
    .name:hover {
      color: color-mix(in srgb, var(--tint) 60%, var(--text-strong));
    }
  }
  .since {
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .tick {
    flex: none;
    color: var(--text-strong);
    font-size: var(--text-row);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
  .stop {
    flex: none;
    border-radius: 50%;
  }
  @media (hover: hover) {
    .stop:hover {
      color: var(--danger);
    }
  }
  .stop svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .start {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .today .orden-section {
    margin: 0 0 var(--space-1);
  }
</style>
