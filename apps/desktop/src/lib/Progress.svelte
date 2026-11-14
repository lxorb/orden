<script lang="ts">
  import Facts from './Facts.svelte'
  import { busy } from './ui-kit/src/api'
  import Sweep from './Sweep.svelte'

  const DELAY = 200

  let showing = $state(false)

  $effect(() => {
    if (!busy.active) {
      showing = false
      return
    }

    const timer = setTimeout(() => (showing = true), DELAY)
    return () => clearTimeout(timer)
  })
</script>

{#if busy.trouble}
  <div class="track failed" role="status" data-covers>
    <div class="line"></div>
    <p class="said">{busy.trouble}</p>
  </div>
{:else if showing}
  <div class="track" role="status" data-covers aria-label={busy.label ?? undefined}>
    <Sweep />
    {#if busy.told}
      <p class="said told"><Facts parts={[busy.label, busy.told]} /></p>
    {/if}
  </div>
{/if}

<style>
  .track {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: var(--z-float);
    pointer-events: none;
    animation: fade-in var(--dur-fast) var(--ease-out);
  }

  .failed .line {
    height: 2px;
    border-radius: 1px;
    background: var(--danger);
  }

  .said {
    margin: var(--space-2) auto 0;
    width: fit-content;
    max-width: min(30rem, calc(100% - var(--space-6)));
    padding: 6px var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-sm);
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .told {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
