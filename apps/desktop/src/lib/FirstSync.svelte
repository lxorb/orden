<script lang="ts">
  import { account } from './account.svelte'
  import { arriving } from './arriving.svelte'
  import { t } from './i18n.svelte'
  import Sweep from './Sweep.svelte'
  import { dur, fade } from './motion'
  import { workspace } from './workspace.svelte'

  const initial = $derived((account.name ?? '?').trim().charAt(0).toUpperCase())

  const holding = $derived(workspace.nothingToShow)
</script>

{#if holding}
  <div
    class="arriving"
    data-covers="all"
    transition:fade={{ duration: dur(190) }}
    role="status"
    aria-live="polite"
  >
    <div class="mark">{initial}</div>

    <div class="line">
      <Sweep />
    </div>

    <p class="said">{arriving.said}</p>

    {#if arriving.stuck}
      <button
        type="button"
        transition:fade={{ duration: dur(130) }}
        onclick={() => arriving.giveUp()}
      >
        {t('Continue')}
      </button>
    {/if}
  </div>
{/if}

<style>
  .arriving {
    position: fixed;
    inset: 0;
    z-index: var(--z-cover);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: var(--bg);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: 1.5rem;
    font-weight: var(--weight-strong);
    animation: settle var(--dur-slow) var(--ease-spring) backwards;
  }

  .line {
    width: 8rem;
    border-radius: 1px;
    background: var(--surface-3);
  }

  .said {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  button {
    padding: 7px 13px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button:hover {
    background: var(--surface-2);
    transform: translateY(-1px);
  }

  button:active {
    background: var(--surface-3);
    transform: translateY(0);
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mark {
      animation: none;
    }
  }
</style>
