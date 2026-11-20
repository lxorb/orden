<script lang="ts">
  import ActivityButton from './ActivityButton.svelte'
  import { ticking } from './days'
  import { clock } from './look'
  import { time } from './time.svelte'

  const { now, compact = false, onmanage }: { now: number; compact?: boolean; onmanage: () => void } = $props()
  const running = $derived(time.running[0] ?? null)
  function picked(activity: string) {
    if (running?.activity !== activity) time.start(activity)
  }
</script>

<div class="now" class:compact class:running={running !== null} data-time-now>
  <div class="what">
    <ActivityButton
      value={running?.activity ?? null}
      placeholder="Start"
      onpick={picked}
      {onmanage}
      strong={!compact}
    />
    <span class="since">{running ? `Since ${clock(running.start)}` : 'Not tracking'}</span>
  </div>
  {#if running}
    <span class="tick" role="timer">{ticking(now - running.start)}</span>
    <button
      type="button"
      class="orden-button is-quiet stop"
      aria-label="Stop timer"
      title="Stop timer"
      onclick={() => time.stop()}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
      <span class="word">Stop</span>
    </button>
  {/if}
</div>

<style>
  .now {
    container: time-now / inline-size;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .what {
    display: flex;
    flex: 1;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    min-width: 0;
  }
  .since {
    color: var(--muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .tick {
    flex: none;
    color: var(--text-strong);
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
  .stop {
    flex: none;
    border: 1px solid var(--line-strong);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  @media (hover: hover) {
    .stop:hover {
      border-color: var(--danger);
      color: var(--danger);
    }
  }
  .stop svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .compact {
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
  }
  .compact .what {
    flex-direction: column;
    align-items: flex-start;
  }
  .compact .since {
    padding-inline: var(--space-1);
    font-size: var(--text-xs);
  }
  .compact .tick {
    font-size: 1.05rem;
  }
  .compact .word {
    display: none;
  }
  .compact .stop {
    width: var(--row-height);
    justify-content: center;
    padding: 0;
  }
  @container (max-width: 480px) {
    .word {
      display: none;
    }
    .tick {
      font-size: 1.25rem;
    }
  }
</style>
