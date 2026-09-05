<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { restartToUpdate } from './updater'

  let { version, ondismiss }: { version: string; ondismiss: () => void } = $props()

  let restarting = $state(false)

  async function restart() {
    restarting = true
    await restartToUpdate()
    // Only reached if the restart failed; the app is normally gone by now.
    restarting = false
  }
</script>

<!-- The download has already happened quietly. This says so and offers the one
     thing left to do, rather than interrupting to ask permission first. -->
<div class="notice" role="status" transition:fly={{ y: 12, duration: 220, easing: cubicOut }}>
  <p>{t('Nib {version} is ready to install.', { version })}</p>

  <div class="actions">
    <button class="later" onclick={ondismiss}>{t('Later')}</button>
    <button class="primary" disabled={restarting} onclick={restart}>{t('Restart now')}</button>
  </div>
</div>

<style>
  .notice {
    position: fixed;
    right: max(var(--space-4), env(safe-area-inset-right));
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    z-index: 40;
    max-width: 22rem;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
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
    gap: var(--space-2);
    flex: none;
  }

  button {
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .later {
    background: none;
    color: var(--muted-strong);
  }

  .later:hover {
    color: var(--text-strong);
  }

  .primary {
    background: var(--accent);
    color: #fff;
    font-weight: 550;
  }

  .primary:hover {
    background: var(--accent-hover);
  }

  .primary:active:not(:disabled) {
    background: var(--accent-press);
  }

  .primary:disabled {
    opacity: 0.6;
  }

  /* A phone has no room beside the text, so the buttons go under it and the
     whole thing spans the screen. */
  @media (max-width: 720px) {
    .notice {
      left: max(var(--space-3), env(safe-area-inset-left));
      right: max(var(--space-3), env(safe-area-inset-right));
      max-width: none;
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-3);
    }

    .actions {
      justify-content: flex-end;
    }

    button {
      min-height: 44px;
      padding: 0 var(--space-4);
    }
  }
</style>
