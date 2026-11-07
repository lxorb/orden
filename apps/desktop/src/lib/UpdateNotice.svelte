<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import Cross from './Cross.svelte'
  import { t } from './i18n.svelte'
  import { type Channel, restartToUpdate } from './updater'
  import { dur, fly } from './motion'
  import { log } from './log'
  import { told } from './said.svelte'

  const {
    version,
    managed = false,
    system = false,
    channel = 'stable',
    ondismiss,
  }: {
    version: string
    managed?: boolean
    system?: boolean
    channel?: Channel
    ondismiss: () => void
  } = $props()

  const news = $derived(managed && !system)

  let command = $state<string | null>(null)

  const STAYS = 6000

  let pointer = $state(false)
  let keys = $state(false)

  function heldBy(card: HTMLElement) {
    const on = {
      pointerenter: () => (pointer = true),
      pointerleave: () => (pointer = false),
      focusin: () => (keys = true),
      focusout: (event: Event) => {
        const to = (event as FocusEvent).relatedTarget
        if (!(to instanceof Node && card.contains(to))) keys = false
      },
    }
    for (const [type, run] of Object.entries(on)) card.addEventListener(type, run)
    return () => {
      for (const [type, run] of Object.entries(on)) card.removeEventListener(type, run)
    }
  }

  $effect(() => {
    if (!news || pointer || keys) return
    const timer = setTimeout(ondismiss, STAYS)
    return () => clearTimeout(timer)
  })

  let restarting = $state(false)
  let moving = $state(false)

  $effect(() => {
    if (managed) return
    void import('./app-place').then(({ stuck }) => stuck()).then((answer) => (moving = answer))
  })

  async function restart() {
    restarting = true
    try {
      if (system && !__EVEN_PLUGIN__)
        command = await (await import('./system-update')).updateBySystem(version, channel)
      else await (moving ? (await import('./app-place')).moveToApplications() : restartToUpdate())
    } catch (error) {
      log('error', `update: ${String(error)}`)
    }
    restarting = false
  }
</script>

<div
  class="notice"
  class:is-news={news}
  class:is-told={command !== null}
  transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
  {@attach told(
    managed
      ? t('Orden {version} is available.', { version })
      : t('Orden {version} is ready to install.', { version }),
  )}
  {@attach heldBy}
>
  {#if command}
    <p>{t('To update, run this in a terminal:')}</p>
    {#await import('./Copyable.svelte') then { default: Copyable }}
      <Copyable value={command} />
    {/await}

    <div class="actions">
      <button class="orden-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
    </div>
  {:else if system}
    <p>{t('Orden {version} is available.', { version })}</p>

    <div class="actions">
      <button class="orden-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
      <button class="orden-button" disabled={restarting} onclick={restart}>{t('Update')}</button>
    </div>
  {:else if news}
    <p>{t('Orden {version} is available.', { version })}</p>
    <button
      class="orden-glyph shut"
      aria-label={t('Dismiss')}
      title={t('Dismiss')}
      onclick={ondismiss}
    >
      <Cross />
    </button>
  {:else}
    <p>{t('Orden {version} is ready to install.', { version })}</p>

    <div class="actions">
      <button class="orden-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
      <button class="orden-button" disabled={restarting} onclick={restart}
        >{moving ? t('Move to Applications') : t('Restart now')}</button
      >
    </div>
  {/if}
</div>

<style>
  .notice {
    grid-column: 3;
    justify-self: end;
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

  .shut {
    margin-inline-end: calc(-1 * var(--space-2));
  }

  .notice.is-told {
    flex-direction: column;
    align-items: stretch;
  }

  .is-told .actions {
    justify-content: flex-end;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }

  .orden-button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  :global([data-touch]) .notice {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
  }

  :global([data-touch]) .actions {
    justify-content: flex-end;
  }

  :global([data-touch]) .orden-button {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
  }

  :global([data-touch]) .notice.is-news {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  :global([data-touch]) .shut {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
