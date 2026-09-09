<script lang="ts">
  /** Who is at this device, and the two switches that belong to the app rather
   *  than to any note.
   *
   *  The bottom of the panel, in the same row height its head has, so the list
   *  of notes sits between two bars that match. Three things and no more: the
   *  account at the left, where a sidebar names its owner in every app that has
   *  one; the theme and the settings at the right, where a switch goes. The
   *  source link is not here - it is a row in the Help menu.
   *
   *  One component on every device. A drawer is the sidebar, so a phone gets
   *  this row at the bottom of the drawer, clear of the gesture bar, and it is
   *  the same three controls in the same order. */
  import { account } from './account.svelte'
  import { initial } from './icons'
  import { settings } from './settings.svelte'
  import { sync } from './sync.svelte'
  import { t } from './i18n.svelte'
  import { theme } from './theme.svelte'

  /** What to call whoever is here. Null while the stores are still being asked,
   *  which is a third state and not the same as being signed out. */
  const who = $derived(account.name)

  /** The settings button doubles as the sync light, so its tooltip says what
   *  the light means rather than leaving a colour to be guessed at. */
  function syncTitle(): string {
    if (sync.status === 'syncing') return t('Syncing')
    if (sync.status === 'error') return sync.lastError ?? t('Sync failed')
    return t('Settings')
  }
</script>

<!-- A region of the window, so F6 reaches the account, the theme and the settings
     without a pointer; see focus.ts. -->
<div class="foot" data-region="foot">
  <!-- The account, which is a row rather than a glyph: a name is what says whose
       notes these are. Signed in or not, it opens the same pane - signing in,
       the name the others in a shared space see, storage and signing out are all
       there, so there is one place for who you are instead of a sheet here and a
       pane there.

       It waits while the stores are still being asked: signed out and not known
       yet are different states, and on a phone the difference is the seconds the
       app takes to answer. -->
  <button
    class="who"
    class:looking={account.restoring}
    title={who ?? t('Sign in')}
    aria-label={who ?? t('Sign in')}
    disabled={account.restoring}
    onclick={() => settings.show('account')}
  >
    <span class="face" aria-hidden="true">
      {#if who}
        {initial(who)}
      {:else}
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
        >
      {/if}
    </span>
    <span class="nib-row-label">{who ?? t('Sign in')}</span>
  </button>

  <div class="acts">
    <!-- Off while the theme in force has only the one scheme: there is no other
         side of it to show, and swapping it for a built-in is not the switch
         anybody pressed. See theme.svelte.ts. -->
    <button
      class="act"
      title={theme.current === 'dark' ? t('Light') : t('Dark')}
      aria-label={t('Switch theme')}
      disabled={!theme.switchable}
      onclick={() => theme.toggle()}
    >
      {#if theme.current === 'dark'}
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="7" r="3" /><path
            d="M7 0v2M7 12v2M0 7h2M12 7h2M2.5 2.5l1.4 1.4M10.1 10.1l1.4 1.4M11.5 2.5l-1.4 1.4M3.9 10.1l-1.4 1.4"
          /></svg
        >
      {:else}
        <svg viewBox="0 0 14 14"
          ><path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" /></svg
        >
      {/if}
    </button>

    <!-- Syncing happens on its own and mostly wants no attention, so its only
         ambient sign is a mark on the button that leads to it: lit while a pass
         is running, red when the last one failed. -->
    <button
      class="act"
      class:syncing={sync.status === 'syncing'}
      class:failed={sync.status === 'error'}
      title={syncTitle()}
      aria-label={t('Settings')}
      onclick={() => settings.show()}
    >
      <!-- An actual gear: eight teeth around a hub. -->
      <svg class="gear" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.2" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"
        />
      </svg>
    </button>
  </div>
</div>

<style>
  /* The same height as the head at the other end of the panel, and set apart by
     the same hairline the head's menu is. */
  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
    border-top: 1px solid var(--line);
  }

  button {
    display: flex;
    align-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  button:disabled {
    opacity: 0.5;
  }

  @media (hover: hover) {
    button:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  button:active:not(:disabled) {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  /* The one part of the row that gives way: a long name is cut, the switches at
     the other end are not. */
  .who {
    flex: 1;
    min-width: 0;
    gap: var(--row-gap);
    min-height: var(--row-height);
    padding: 0 calc(var(--row-pad) - var(--space-1));
    font-size: var(--text-row);
    text-align: left;
  }

  /* The name starts beside its mark, the way a name in the list above starts
     beside its own; only the room it is given differs. */
  .who .nib-row-label {
    flex: 0 1 auto;
  }

  /* The letter whoever is here is known by, in the square a space wears its own
     mark in, so the two marks in the panel are the same shape. */
  .face {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: calc(var(--row-height-sm) * 0.32);
    background: var(--surface-2);
    font-size: calc(var(--row-height-sm) * 0.46);
    font-weight: 620;
  }

  .face svg {
    width: var(--icon-md);
    height: var(--icon-md);
  }

  /* Still asking the stores whether there is a session. Not a spinner and not a
     sentence: the row that would sign you in simply waits, and breathes while
     it does. */
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

  .acts {
    flex: none;
    display: flex;
    gap: 2px;
  }

  .act {
    position: relative;
    justify-content: center;
    width: var(--row-height);
    height: var(--row-height);
  }

  svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .gear {
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  /* A dot in the corner, not a badge: it is there to be noticed out of the
     corner of an eye and otherwise ignored. */
  .act.syncing::after,
  .act.failed::after {
    content: '';
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .act.syncing::after {
    animation: breathe 1100ms var(--ease-in-out) infinite;
  }

  .act.failed::after {
    background: var(--danger);
  }

  @keyframes breathe {
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .act.syncing::after,
    .looking {
      animation: none;
    }

    .act.syncing::after {
      opacity: 0.6;
    }
  }

  /* Above whatever the system keeps at the bottom of the screen, so the last
     row of the panel is not under the gesture bar. */
  :global([data-touch]) .foot {
    padding-bottom: var(--inset-bottom);
  }
</style>
