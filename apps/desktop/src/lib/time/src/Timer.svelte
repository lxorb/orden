<script lang="ts">
  import { menu } from '../../ui-kit/src/api'
  import { ticking } from './days'
  import { clock, nameOf, tintOf } from './look'
  import { time } from './time.svelte'

  const { now, wide = false }: { now: number; wide?: boolean } = $props()
  let named = $state('')
  const running = $derived(time.running[0] ?? null)
  const choices = $derived(time.latest())
  function picked(event: MouseEvent) {
    const span = running
    menu.show(
      event,
      choices.map((one) => ({
        label: one.name,
        checked: one.id === span?.activity,
        run: () => (span ? time.changeSpan(span.id, { activity: one.id }) : time.start(one.id)),
      })),
      { title: 'Activity' },
    )
  }
  function added() {
    if (!named.trim()) return
    time.addActivity(named)
    named = ''
  }
</script>

<div class="timer" class:wide class:running={running !== null}>
  {#if running}
    <span class="dot" style:background={tintOf(running.activity)}></span>
    <button type="button" class="what" aria-haspopup="menu" onclick={picked}>
      <span class="name">{nameOf(running.activity, 'No activity')}</span>
      <span class="since">Since {clock(running.start)}</span>
    </button>
    <span class="tick" role="timer">{ticking(now - running.start)}</span>
    <button
      type="button"
      class="orden-button is-danger go"
      aria-label="Stop timer"
      title="Stop timer"
      onclick={() => time.stop()}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
    </button>
  {:else if choices.length}
    <button type="button" class="what" aria-haspopup="menu" onclick={picked}>
      <span class="name">Start an activity</span>
    </button>
    <button
      type="button"
      class="orden-button go"
      aria-label="Start timer"
      title="Start timer"
      aria-haspopup="menu"
      onclick={picked}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6L9.8 6z" /></svg>
    </button>
  {:else}
    <input
      class="orden-field asking"
      aria-label="New activity"
      placeholder="New activity"
      bind:value={named}
      onkeydown={(event) => {
        if (event.key === 'Enter') added()
      }}
    />
    <button type="button" class="orden-button" disabled={!named.trim()} onclick={added}>Add</button>
  {/if}
</div>

<style>
  .timer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .timer.running {
    padding-inline-start: var(--space-3);
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .since {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .tick {
    flex: none;
    color: var(--text-strong);
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
  .asking {
    flex: 1;
    min-width: 0;
  }
  .go {
    flex: none;
    width: var(--row-height);
    padding: 0;
  }
  .go svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .wide {
    padding: var(--space-3);
  }
  .wide .tick {
    font-size: 1.6rem;
  }
  .wide .go {
    width: auto;
    min-width: 3rem;
  }
</style>
