<script lang="ts">
  import { account } from './account.svelte'
  import { showAccount } from './account-menu'
  import AccountBadge from './AccountBadge.svelte'
  import { DOWNLOAD_URL } from './links'
  import { arriving } from './arriving.svelte'
  import { longPress } from './longpress'
  import { dur, fade } from './motion'
  import { settings } from './settings.svelte'
  import { showFeedback } from './surfaces.svelte'
  import { t } from './i18n.svelte'
  import { isNative, openExternal } from './tauri'
  import { theme } from './theme.svelte'
  import { viewport } from './viewport.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { SCRATCHPAD_MARK } from './panel-marks'
  import { scratchFromDrawer, shown as pad } from './scratchpad/is.svelte'

  const {
    theming = true,
    scratch = true,
    onwho = showAccount,
    onsettings = () => settings.show(),
  }: {
    theming?: boolean
    scratch?: boolean
    onwho?: (event: MouseEvent) => void
    onsettings?: () => void
  } = $props()

  const who = $derived(account.name)

  const pick = (event: MouseEvent) =>
    void import('./theme-picker/picking.svelte').then((one) => one.pickTheme(event))
</script>

<div class="foot" data-region="foot">
  <button
    class="who"
    class:looking={account.restoring}
    title={who ?? t('Sign in')}
    aria-label={who ?? t('Sign in')}
    disabled={account.restoring}
    aria-haspopup="menu"
    onclick={onwho}
  >
    <AccountBadge />
    <span class="orden-row-label">{who ?? t('Sign in')}</span>
  </button>

  {#if arriving.showing}
    <span class="coming" transition:fade={{ duration: dur(160) }} role="status" aria-live="polite">
      {arriving.said}
    </span>
  {/if}

  <div class="acts">
    {#if !isNative && !__EVEN_PLUGIN__ && !viewport.touch}
      <button
        class="orden-glyph act"
        title={t('Download the app')}
        aria-label={t('Download the app')}
        onclick={() => void openExternal(DOWNLOAD_URL)}
      >
        <svg viewBox="0 0 14 14"><path d="M7 1.5v7.5M3.8 6l3.2 3.2L10.2 6M2 12.5h10" /></svg>
      </button>
    {/if}

    <button
      class="orden-glyph act"
      title={t('Send feedback')}
      aria-label={t('Send feedback')}
      onclick={showFeedback}
    >
      <svg class="bug" viewBox="0 0 14 14"
        ><path
          d="M4.6 4.2a2.4 2.4 0 0 1 4.8 0M3.9 5.4h6.2v3.4a3.1 3.1 0 0 1-6.2 0zM7 5.4v6.4M3.9 7.4H1.6M10.1 7.4h2.3M4.2 9.9l-1.9 1.4M9.8 9.9l1.9 1.4M4.4 5.4 2.6 3.8M9.6 5.4l1.8-1.6"
        /></svg
      >
    </button>

    {#if theming && !viewport.touch}
      <button
        class="orden-glyph act"
        title={theme.current === 'dark' ? t('Light') : t('Dark')}
        aria-label={theme.current === 'dark' ? t('Light') : t('Dark')}
        aria-disabled={!theme.switchable}
        onclick={() => theme.toggle()}
        oncontextmenu={pick}
        use:longPress={pick}
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
    {/if}

    {#if scratch && viewport.touch && !__EVEN_PLUGIN__}
      <button
        class="orden-glyph act"
        class:is-on={pad.on}
        aria-pressed={pad.on}
        title={shortcuts.tooltip(t('Scratchpad'), 'app.scratchpad')}
        aria-label={t('Scratchpad')}
        onclick={scratchFromDrawer}
      >
        <svg viewBox="0 0 13 13"><path d={SCRATCHPAD_MARK} /></svg>
      </button>
    {/if}

    <button
      class="orden-glyph act"
      title={shortcuts.tooltip(t('Settings'), 'app.settings')}
      aria-label={t('Settings')}
      onclick={onsettings}
    >
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
  .foot {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
    border-top: 1px solid var(--chrome-seam);
  }

  .who {
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

    flex: 1;
    min-width: 0;
    gap: var(--row-gap);
    min-height: var(--row-height);
    padding: 0 calc(var(--row-pad) - var(--space-1));
    font-size: var(--text-row);
    text-align: start;
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  @media (hover: hover) {
    .who:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .who:active:not(:disabled) {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .who .orden-row-label {
    flex: 0 1 auto;
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

  .coming {
    flex: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }

  .acts {
    flex: none;
    display: flex;
    gap: 2px;
  }

  .act .gear {
    stroke-width: 1.6;
  }

  .act .bug {
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (prefers-reduced-motion: reduce) {
    .looking {
      animation: none;
    }
  }

  :global([data-touch]:not([data-device='phone'])) .foot {
    padding-bottom: max(0px, calc(var(--inset-bottom) - var(--keyboard, 0px)));
  }
</style>
