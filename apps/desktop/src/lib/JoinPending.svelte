<script lang="ts">
  import { Cross } from './ui-kit/src/api'
  import { joining } from './joining.svelte'

  const who = $derived(joining.invitation?.from ?? 'Somebody')
  const said = $derived(
    joining.step === 'waiting'
      ? `Waiting for ${who}`
      : `${who} shared ${joining.invitation?.note ?? joining.invitation?.space ?? ''} with you`,
  )
</script>

{#if joining.aside}
  <div class="orden-bar pending">
    <button type="button" class="open" onclick={() => joining.reopen()}>
      {#if joining.step === 'waiting'}<span class="pulse"></span>{/if}
      {said}
    </button>
    {#if joining.step === 'asking'}
      <button
        type="button"
        class="orden-glyph"
        aria-label="Dismiss"
        title="Dismiss"
        onclick={() => joining.dismiss()}
      >
        <Cross />
      </button>
    {/if}
  </div>
{/if}

<style>
  .pending {
    grid-column: 2;
    align-items: center;
    animation: pill-in var(--dur-base) var(--ease-spring);
  }

  .open {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding-inline: var(--space-3);
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: default;
  }

  :global([data-touch]) .pending {
    grid-column: 1;
    justify-self: center;
  }

  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-3));
    }
  }

  .pulse {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    animation: breathe 1.8s var(--ease-out) infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pending,
    .pulse {
      animation: none;
    }
  }
</style>
