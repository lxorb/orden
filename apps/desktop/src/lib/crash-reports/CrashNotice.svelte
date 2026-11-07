<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { told } from '../said.svelte'
  import { settings } from '../settings.svelte'
  import { crashReports } from './choice.svelte'

  crashReports.tell()

  const words = $derived(
    t(
      'When Orden crashes or freezes, it sends what it was doing and where in its own code, with names, paths, addresses and passwords taken out, and never your notes.',
    ),
  )
</script>

{#if crashReports.telling}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
  >
    <p>{words}</p>
    <div class="actions">
      <button class="quiet" onclick={() => crashReports.told()}>{t('OK')}</button>
      <button
        class="link"
        onclick={() => {
          crashReports.told()
          settings.show('general')
        }}
      >
        {t('Turn off in Settings')}
      </button>
    </div>
  </div>
{/if}

<style>
  .toast {
    grid-column: 2;
    justify-self: center;
    max-width: 24rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
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
    color: var(--muted);
  }

  .link {
    color: var(--accent);
  }
</style>
