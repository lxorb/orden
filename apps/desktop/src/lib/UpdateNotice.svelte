<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Cross from './Cross.svelte'
  import { t } from './i18n.svelte'
  import { type Channel, restartToUpdate } from './updater'
  import { dur } from './motion'
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
    /** A package manager keeps this install: the notice only says what is out. */
    managed?: boolean
    /** Unless it is apt or dnf, whose install this updates through PackageKit (#1147). */
    system?: boolean
    channel?: Channel
    ondismiss: () => void
  } = $props()

  const news = $derived(managed && !system)

  /** What to run in a terminal, where PackageKit could not update it. */
  let command = $state<string | null>(null)

  /** How long the news stays when there is nothing to do about it; the rename
   *  notice's, long enough to read it twice. */
  const STAYS = 6000

  /** The pointer on it, or the keyboard in it, which keeps it up. */
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
  /** Moved to Applications first where it cannot update; see app-place.ts. */
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
    // Only reached if the restart failed; the app is normally gone by now.
    restarting = false
  }
</script>

<!-- The download has already happened quietly. This says so and offers the one
     thing left to do, rather than interrupting to ask permission first. Where a
     package manager keeps the install there is nothing to do here, so it is news:
     a cross, and gone on its own after a while. -->
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
    <!-- Only ever shown after a failed update, so not part of the first paint. -->
    {#await import('./Copyable.svelte') then { default: Copyable }}
      <Copyable value={command} />
    {/await}

    <div class="actions">
      <button class="nib-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
    </div>
  {:else if system}
    <p>{t('Orden {version} is available.', { version })}</p>

    <div class="actions">
      <button class="nib-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
      <button class="nib-button" disabled={restarting} onclick={restart}>{t('Update')}</button>
    </div>
  {:else if news}
    <p>{t('Orden {version} is available.', { version })}</p>
    <button
      class="nib-glyph shut"
      aria-label={t('Dismiss')}
      title={t('Dismiss')}
      onclick={ondismiss}
    >
      <Cross />
    </button>
  {:else}
    <p>{t('Orden {version} is ready to install.', { version })}</p>

    <div class="actions">
      <button class="nib-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
      <button class="nib-button" disabled={restarting} onclick={restart}
        >{moving ? t('Move to Applications') : t('Restart now')}</button
      >
    </div>
  {/if}
</div>

<style>
  /* The last track of the notices row, which floats over the foot of the panes;
     App.svelte places it. */
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

  /* The cross's box has room round the mark, so it reaches into the card's padding
     and the mark sits where the edge of the words would. */
  .shut {
    margin-inline-end: calc(-1 * var(--space-2));
  }

  /* The words, the command under them, and Later under that. */
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

  /* Both buttons are `.nib-button` in the themes package - the accent one and
     `is-quiet` beside it. They were their own pair here: a smaller corner, a
     smaller type size, no lift under the pointer where the sign-in panel's
     lifted, and a fade of 0.6 where the app's is 0.4. A notice is small, so the
     words are the size the sentence beside them is read at. */
  .nib-button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  /* A phone has no room beside the text, so the buttons go under it and the
     whole thing spans the row. */
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

  :global([data-touch]) .nib-button {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
  }

  /* News keeps its cross beside the line, at the size a finger needs. */
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
