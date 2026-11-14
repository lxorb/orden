<script lang="ts">
  import { pens } from './pens.svelte'
  import { tick } from '../../ui-controls/src/api'

  const WAYS = [
    { box: false, word: () => 'Lasso' },
    { box: true, word: () => 'Rectangle' },
  ] as const
</script>

<div class="catch">
  <div class="orden-segmented">
    {#each WAYS as one (one.box)}
      <button
        type="button"
        class:on={pens.box === one.box}
        title={one.word()}
        aria-label={one.word()}
        aria-pressed={pens.box === one.box}
        onclick={() => {
          tick()
          pens.catching({ box: one.box })
        }}
      >
        {one.word()}
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="partly"
    class:on={pens.partly}
    title="Include what it touches"
    aria-label="Include what it touches"
    aria-pressed={pens.partly}
    onclick={() => {
      tick()
      pens.catching({ partly: !pens.partly })
    }}
  >
    Include what it touches
  </button>
</div>

<style>
  .catch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .partly {
    min-height: 34px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .partly:active {
    background: var(--press);
  }

  .partly.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  :global([data-touch]) .partly {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
