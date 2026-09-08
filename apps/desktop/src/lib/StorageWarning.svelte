<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { settings } from './settings.svelte'
  import { readableSize, usage } from './usage.svelte'
</script>

<!-- Bottom left, out of the way of the update notice on the right and of the
     button that makes new notes. -->
{#if usage.warning}
  <div class="toast" role="status" transition:fly={{ y: 12, duration: 220, easing: cubicOut }}>
    <p>
      {t('{used} of {limit} used.', {
        used: readableSize(usage.used),
        limit: readableSize(usage.limit),
      })}
    </p>

    <div class="actions">
      <button class="quiet" onclick={() => (usage.dismissed = true)}>{t('Dismiss')}</button>
      <button
        class="link"
        onclick={() => {
          usage.dismissed = true
          settings.show('account')
        }}
      >
        {t('Manage storage')}
      </button>
    </div>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: max(var(--space-4), var(--inset-left));
    bottom: calc(var(--space-4) + var(--inset-bottom));
    z-index: 40;
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
    font-weight: 550;
  }

  :global([data-touch]) .toast {
    right: max(var(--space-4), var(--inset-right));
    max-width: none;
  }

  :global([data-touch]) button {
    min-height: 44px;
  }
</style>
