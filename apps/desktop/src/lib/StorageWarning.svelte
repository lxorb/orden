<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { settings } from './settings.svelte'
  import { readableSize, usage } from './usage.svelte'
  import { dur, fly } from './platform/src/api'
  import { told } from './said.svelte'

  const words = $derived(`${readableSize(usage.used)} of ${readableSize(usage.limit)} used.`)
</script>

{#if usage.warning}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
  >
    <p>{words}</p>

    <div class="actions">
      <button class="quiet" onclick={() => (usage.dismissed = true)}>Dismiss</button>
      <button
        class="link"
        onclick={() => {
          usage.dismissed = true
          settings.show('account')
        }}
      >
        Manage storage
      </button>
    </div>
  </div>
{/if}

<style>
  .toast {
    grid-column: 1;
    justify-self: start;
    max-width: 20rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
  }

  p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .actions {
    display: flex;
    gap: var(--space-3);
  }

  button {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .quiet {
    color: var(--muted-strong);
  }

  .quiet:hover {
    color: var(--text-strong);
  }

  .link {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  :global([data-touch]) .toast {
    justify-self: stretch;
    max-width: none;
  }

  :global([data-touch]) button {
    min-height: var(--touch-target);
  }
</style>
