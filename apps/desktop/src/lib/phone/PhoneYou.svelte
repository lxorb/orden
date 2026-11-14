<script lang="ts">
  import { account } from '../accounts/src/api'
  import { showAccount } from '../account-menu'
  import { AccountBadge } from '../accounts/src/api'
  import { arriving } from '../arriving.svelte'
  import { dur, fade } from '../platform/src/api'
  import { scratchFromDrawer } from '../scratchpad/src/api'
  import { showFeedback } from '../surfaces.svelte'

  const who = $derived(account.name)

  function show(event: MouseEvent) {
    showAccount(
      event,
      [
        { label: 'Scratchpad', run: scratchFromDrawer },
        { label: 'Send feedback', run: showFeedback },
      ],
      false,
    )
  }
</script>

{#if arriving.showing}
  <span class="coming" transition:fade={{ duration: dur(160) }} role="status" aria-live="polite">
    {arriving.said}
  </span>
{/if}
<button
  class="you"
  class:looking={account.restoring}
  data-phone-you
  aria-label={who ?? 'Sign in'}
  aria-haspopup="menu"
  disabled={account.restoring}
  onclick={show}
>
  <AccountBadge />
</button>

<style>
  .you {
    flex: none;
    display: grid;
    place-items: center;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    margin-inline-start: auto;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .you:active:not(:disabled) {
    transform: scale(0.92);
  }

  .looking {
    animation: looking 1.6s var(--ease-in-out) infinite;
  }

  @keyframes looking {
    0%,
    100% {
      opacity: 0.4;
    }

    50% {
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .looking {
      animation: none;
    }
  }

  .coming {
    min-width: 0;
    margin-inline-start: auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .coming + .you {
    margin-inline-start: 0;
  }
</style>
