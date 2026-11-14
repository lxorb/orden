<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { importing } from './importing.svelte'
  import { dur, fly } from './platform/src/api'
  import { told } from './said.svelte'
  import { forget, isRecord, isString, stored } from './platform/src/api'
  import { OUTSIDE } from './surfaces.svelte'

  const said = stored(OUTSIDE)
  forget(OUTSIDE)
  const folder = isRecord(said) && isString(said.folder) ? said.folder : ''
  const left = isRecord(said) && Array.isArray(said.left) ? said.left.filter(isString) : []

  let showing = $state(folder !== '')

  const words = $derived(
    [
      `Orden no longer opens ${folder} in place. Its spaces are kept in Orden now, and the folder is left as it was. To bring in more from it, use Import.`,
      ...(left.length
        ? [
            `Not copied yet, so still only in that folder: ${left.join(', ')}. Orden tries again the next time it starts.`,
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
      <button class="quiet" onclick={() => (showing = false)}>Dismiss</button>
      <button
        class="link"
        onclick={() => {
          showing = false
          importing.show()
        }}
      >
        Import
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
