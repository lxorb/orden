<script lang="ts">
  import { midnightOf } from '../../../platform/src/api'
  import { BottomSheet, tick } from '../../../ui-controls/src/api'
  import ActivityFind from '../ActivityFind.svelte'
  import ActivityMark from '../ActivityMark.svelte'
  import { daysAfter, piecesIn, ticking as tickingText } from '../days'
  import { clock, length, nameOf, tintOf } from '../look'
  import { rangeTotals } from '../schedule'
  import { time } from '../time.svelte'

  const { now, onday }: { now: number; onday: (at?: number) => void } = $props()
  const MOST_RECENT = 3
  const MOST_TILES = 11
  let adding = $state(false)
  const today = $derived(midnightOf(now))
  const tomorrow = $derived(daysAfter(today, 1))
  const running = $derived(time.running[0] ?? null)
  const tiles = $derived(
    time
      .latest()
      .filter((one) => !one.archived)
      .slice(0, MOST_TILES),
  )
  const mine = (span: { activity: string | null; source: string }) =>
    span.activity !== null && (span.source === 'manual' || span.source === 'timer')
  const pieces = $derived(piecesIn(time.spans, today, tomorrow, now, mine).filter((one) => one.to > one.from))
  const recent = $derived(pieces.slice(-MOST_RECENT).reverse())
  const first = $derived(pieces.reduce((least, one) => Math.min(least, one.from), now))
  const whole = $derived(Math.max(now - first, 1))
  const tracked = $derived(rangeTotals(time.spans, [], today, tomorrow, now, { untracked: false }).ms)
  function tap(activity: string) {
    tick()
    if (running?.activity === activity) return
    time.start(activity)
  }
  function picked(activity: string) {
    adding = false
    tap(activity)
  }
</script>

<section class="hero" class:idle={!running} style:--tint={tintOf(running?.activity ?? null)} data-track-running>
  {#if running}
    <span class="badge"><ActivityMark activity={running.activity} size={26} /></span>
    <div class="what">
      <span class="name">{nameOf(running.activity, 'Not set')}</span>
      <span class="since">{clock(running.start)}</span>
    </div>
    <span class="tick" role="timer" aria-label="Running for">{tickingText(now - running.start)}</span>
    <button type="button" class="stop" aria-label="Stop" data-track-stop onclick={() => time.stop()}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1.6" /></svg>
    </button>
  {:else}
    <span class="tick quiet" role="timer" aria-label="Nothing running">0:00</span>
  {/if}
</section>

<div class="tiles" role="group" aria-label="Activities">
  {#each tiles as one (one.id)}
    <button
      type="button"
      class="tile"
      class:on={running?.activity === one.id}
      style:--tint={tintOf(one.id)}
      aria-pressed={running?.activity === one.id}
      data-track-tile={one.name}
      onclick={() => tap(one.id)}
    >
      <ActivityMark activity={one.id} size={24} />
      <span>{one.name}</span>
    </button>
  {/each}
  <button type="button" class="tile add" aria-label="Another activity" data-track-add onclick={() => (adding = true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  </button>
</div>

{#if recent.length}
  <ul class="recent" aria-label="Latest blocks">
    {#each recent as piece (piece.span.id)}
      <li>
        <button
          type="button"
          class="block"
          style:--tint={tintOf(piece.span.activity)}
          data-track-recent={piece.span.id}
          onclick={() => onday(piece.from)}
        >
          <ActivityMark activity={piece.span.activity} size={20} />
          <span class="name">{nameOf(piece.span.activity, 'Not set')}</span>
          <span class="at">{clock(piece.from)}</span>
          <span class="long"
            >{piece.span.end === null ? tickingText(now - piece.from) : length(piece.to - piece.from)}</span
          >
        </button>
      </li>
    {/each}
  </ul>
{/if}

<button
  type="button"
  class="strip"
  aria-label="Today, {length(tracked)} tracked"
  data-track-today
  onclick={() => onday()}
>
  <span class="lane">
    {#each pieces as piece (piece.span.id)}
      <span
        class="piece"
        style:--tint={tintOf(piece.span.activity)}
        style:left="{((piece.from - first) / whole) * 100}%"
        style:width="{((piece.to - piece.from) / whole) * 100}%"
      ></span>
    {/each}
  </span>
  <span class="sum">{length(tracked)}</span>
</button>

<BottomSheet open={adding} label="Activity" onclose={() => (adding = false)}>
  <ActivityFind placeholder="Activity" onpick={picked} onescape={() => (adding = false)} />
</BottomSheet>

<style>
  .hero {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas: 'badge what stop' 'tick tick tick';
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-4);
    border-radius: 24px;
    background: color-mix(in srgb, var(--tint) 22%, var(--surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 40%, transparent);
  }
  .hero.idle {
    grid-template-areas: 'tick tick tick';
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .badge {
    grid-area: badge;
    display: grid;
    place-items: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border-radius: 16px;
    background: color-mix(in srgb, var(--tint) 30%, var(--bg));
  }
  .what {
    grid-area: what;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .what .name {
    font-size: 1.25rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .since {
    font-size: var(--text-sm);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tick {
    grid-area: tick;
    font-size: clamp(2rem, 15vw, 3.5rem);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: var(--space-2) 0;
  }
  .tick.quiet {
    color: var(--muted);
  }
  .stop {
    grid-area: stop;
    width: 52px;
    height: 52px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .stop:active {
    transform: scale(0.92);
  }
  .stop svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: var(--space-2);
  }
  .tile {
    min-height: 76px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--space-2) var(--space-1);
    border: none;
    border-radius: 20px;
    background: color-mix(in srgb, var(--tint) 16%, var(--surface));
    color: var(--text);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  .tile span:last-child {
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: center;
  }
  .tile:active {
    transform: scale(0.94);
  }
  .tile.on {
    background: color-mix(in srgb, var(--tint) 34%, var(--surface));
    box-shadow:
      inset 0 0 0 2px var(--tint),
      0 6px 20px color-mix(in srgb, var(--tint) 35%, transparent);
  }
  .tile.add {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--line);
    color: var(--muted);
  }
  .tile.add svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .block {
    width: 100%;
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: 14px;
    background: color-mix(in srgb, var(--tint) 10%, var(--surface));
    color: var(--text);
    font: inherit;
    text-align: start;
    -webkit-tap-highlight-color: transparent;
  }
  .block .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .at {
    color: var(--muted);
  }
  .at,
  .long {
    font-variant-numeric: tabular-nums;
  }
  .strip {
    margin-top: auto;
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: none;
    border-radius: 18px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .lane {
    position: relative;
    flex: 1;
    height: 14px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    overflow: hidden;
  }
  .piece {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--tint);
  }
  @media (forced-colors: active) {
    .piece {
      background: Highlight;
    }
  }
  .sum {
    font-size: var(--text-md);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
</style>
