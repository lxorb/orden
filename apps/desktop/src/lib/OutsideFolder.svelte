<script lang="ts">
  /** Said once, after `spaces-folder` named a folder outside Orden's own (#552): Orden no
   *  longer opens it in place, its spaces were copied in and it was left as it was, and
   *  Import is the way to bring in more of it. What could not be copied is named, and
   *  said again at each launch until it is. See workspace/outside.ts. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { importing } from './importing.svelte'
  import { dur } from './motion'
  import { told } from './said.svelte'
  import { forget, isRecord, isString, stored } from './stored'
  import { OUTSIDE } from './surfaces.svelte'

  const said = stored(OUTSIDE)
  forget(OUTSIDE)
  const folder = isRecord(said) && isString(said.folder) ? said.folder : ''
  const left = isRecord(said) && Array.isArray(said.left) ? said.left.filter(isString) : []

  let showing = $state(folder !== '')

  const words = $derived(
    [
      t(
        'Orden no longer opens {folder} in place. Its spaces are kept in Orden now, and the folder is left as it was. To bring in more from it, use Import.',
        { folder },
      ),
      ...(left.length
        ? [
            t(
              'Not copied yet, so still only in that folder: {names}. Orden tries again the next time it starts.',
              { names: left.join(', ') },
            ),
          ]
        : []),
    ].join(' '),
  )
</script>

{#if showing}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
  >
    <p>{words}</p>
    <div class="actions">
      <button class="quiet" onclick={() => (showing = false)}>{t('Dismiss')}</button>
      <button
        class="link"
        onclick={() => {
          showing = false
          importing.show()
        }}
      >
        {t('Import')}
      </button>
    </div>
  </div>
{/if}

<style>
  /* The middle track of the notices row, as the rename notice's and KeysMoved's. */
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
    overflow-wrap: anywhere;
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
