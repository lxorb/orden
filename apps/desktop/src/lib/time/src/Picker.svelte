<script lang="ts">
  import ActivityButton from './ActivityButton.svelte'
  import { ticking } from './days'
  import { clock } from './look'
  import { time } from './time.svelte'

  const { now, wide = false, onmanage }: { now: number; wide?: boolean; onmanage: () => void } = $props()
  const running = $derived(time.running[0] ?? null)
  function picked(activity: string) {
    if (running?.activity !== activity) time.start(activity)
  }
</script>

<div class="picker" class:wide class:running={running !== null}>
  <ActivityButton value={running?.activity ?? null} placeholder="Start" onpick={picked} {onmanage} strong={wide} />
  {#if running}
    {#if wide}<span class="since">Since {clock(running.start)}</span>{/if}
    <span class="tick" role="timer">{ticking(now - running.start)}</span>
    <button
      type="button"
      class="orden-button is-danger stop"
      aria-label="Stop timer"
      title="Stop timer"
      onclick={() => time.stop()}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
    </button>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .picker > :global(.choose) {
    flex: 0 1 auto;
  }
  .since {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tick {
    flex: none;
    margin-inline-start: auto;
    color: var(--text-strong);
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
  .stop {
    flex: none;
    width: var(--row-height);
    padding: 0;
  }
  .stop svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .wide .tick {
    font-size: 1.6rem;
  }
  .wide .since {
    font-size: var(--text-sm);
  }
  .wide .stop {
    width: auto;
    min-width: 3rem;
  }
</style>
