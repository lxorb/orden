<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { told } from '../../said.svelte'
  import { settings } from '../../settings.svelte'
  import { keysMoved } from './keys-moved.svelte'

  const words = $derived(
    'Orden no longer keeps AI keys in the Mac’s keychain, which kept asking for its password. Enter your keys and sign in to ChatGPT once more.',
  )
</script>

{#if keysMoved.showing}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
  >
    <p>{words}</p>
    <div class="actions">
      <button class="quiet" onclick={() => keysMoved.dismiss()}>Dismiss</button>
      <button
        class="link"
        onclick={() => {
          keysMoved.dismiss()
          settings.show('ai')
        }}
      >
        Settings › AI
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
