<script lang="ts">
  import { untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { plural, t } from './i18n.svelte'
  import { focusEditor } from './focus'
  import { dur } from './motion'
  import { told } from './said.svelte'
  import { reservedName } from './reserved-name.svelte'
  import { back } from './sync2/resurrected.svelte'
  import { undoToast } from './undo-toast.svelte'
  import { unread } from './unread.svelte'
  import { unsynced } from './sync2/unsynced.svelte'
  import { failed } from './views/failed.svelte'
  import { workspace } from './workspace.svelte'

  /** The one word for each thing the toast can take back. */
  const word = $derived({
    delete: t('Deleted'),
    move: t('Moved'),
    archive: t('Archived'),
    unarchive: t('Unarchived'),
    done: t('Completed'),
    scheduled: t('Scheduled'),
    moved: t('Moved'),
    deleted: t('Deleted'),
  })

  // What is on the stack already, before this was on the page, is nobody's news.
  undoToast.know(workspace.undone.stack)

  // The stack is what this follows. The toast's own batch is read and written in the
  // same call, and an effect that depended on it would run again on its own write.
  $effect(() => {
    const stack = workspace.undone.stack
    untrack(() => undoToast.heard(stack))
  })

  // An Undo offered after a board's write failed is the newer news, and the Retry goes.
  $effect(() => {
    if (undoToast.kind) untrack(() => failed.dismiss())
  })

  /** The Undo's words and the way back with them, said again for each action that joins
   *  it though the words are the same: the batch is read so the attachment runs again. */
  function toldUndo(kind: keyof typeof word) {
    return told(undoToast.batch.length ? `${word[kind]}. ${t('Undo')}` : '')
  }

  /** Which card is up, of the ones that take turns in one place. */
  const turn = $derived(
    reservedName.root
      ? 'reserved'
      : failed.retry
        ? 'failed'
        : undoToast.kind
          ? 'undo'
          : unread.shown
            ? 'unread'
            : null,
  )

  /** Whether each card is up, by the name `kept` is given. */
  const up = {
    reserved: () => turn === 'reserved',
    failed: () => turn === 'failed',
    undo: () => turn === 'undo',
    back: () => !!back.said,
    unsynced: () => !!unsynced.said,
  }

  /** The card the keyboard is in or was last in, and what it came to the card from. */
  let holding: { card: HTMLElement; name: keyof typeof up; from: HTMLElement | null } | null = null

  /** The keyboard, handed back to where it came from as a card goes from under it. */
  function handBack() {
    const from = holding?.from
    holding = null
    if (from?.isConnected) from.focus({ preventScroll: true })
    // In the page and out of reach is the same: a side shut since says nothing else.
    if (!from || document.activeElement !== from) focusEditor()
  }

  // A card that goes while the keyboard is in it - Undo pressed, Ctrl+Z, a newer card
  // in its place - hands the keyboard back. Before the page changes rather than
  // after: a card on its way out is made inert at once, and the keyboard in it would
  // be dropped on the page.
  $effect.pre(() => {
    for (const going of Object.values(up)) going()
    untrack(() => {
      if (!holding || up[holding.name]()) return
      if (holding.card.contains(document.activeElement)) handBack()
      else holding = null
    })
  })

  /** Kept up while the pointer is on it or the keyboard is in it, and let go once
   *  neither is: a hand on its way to Undo is not beaten to it by the clock, and nor
   *  is a key that walked to it with F6 (#523). */
  function kept(name: keyof typeof up, toast?: { hold(): void; linger(): void }) {
    return (card: HTMLElement) => {
      let pointer = false
      let keys = false
      let from: HTMLElement | null = null
      const go = () => {
        if (!pointer && !keys) toast?.linger()
      }
      const on = {
        pointerenter: () => {
          pointer = true
          toast?.hold()
        },
        pointerleave: () => {
          pointer = false
          go()
        },
        focusin: (event: Event) => {
          const came = (event as FocusEvent).relatedTarget
          if (came instanceof HTMLElement && !card.contains(came)) from = came
          keys = true
          holding = { card, name, from }
          toast?.hold()
        },
        focusout: (event: Event) => {
          const to = (event as FocusEvent).relatedTarget
          if (to instanceof Node && card.contains(to)) return
          keys = false
          // Nowhere is the window losing the keyboard or the card losing the page, and
          // neither is the keyboard having gone somewhere else.
          if (to instanceof Node) {
            from = null
            if (holding?.card === card) holding = null
          }
          if (up[name]()) go()
        },
      }
      for (const [type, run] of Object.entries(on)) card.addEventListener(type, run)
      return () => {
        for (const [type, run] of Object.entries(on)) card.removeEventListener(type, run)
        // Taken off the page with the keyboard in it, with no card going first.
        const at = document.activeElement
        if (holding?.card === card && (at === document.body || at === null || card.contains(at)))
          // After the card has left the page, or a press there has nothing to land on.
          queueMicrotask(handBack)
      }
    }
  }

  // Gone with the component, and the timers with it.
  $effect(() => () => {
    undoToast.dismiss()
    reservedName.dismiss()
    unread.dismiss()
    failed.dismiss()
    back.dismiss()
    unsynced.dismiss()
  })
</script>

<!-- One word for what happened and one for the way back: the row it was about has
     already gone or moved, which says the rest. A failed carry comes first: whichever of
     the two came last dismissed the other, so this only decides a tie. -->
{#if reservedName.root}
  <!-- A note called AGENTS refused where there is no field to say so in: the palette's
       way round it aside, a link, a drop, the name a save was given. Gmail's snackbar,
       one line and the way there. See reserved-name.svelte.ts. -->
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(t("AGENTS is this space's agent instructions"))}
    {@attach kept('reserved')}
  >
    <p>{t("AGENTS is this space's agent instructions")}</p>
    <button class="undo" onclick={() => reservedName.open()}>{t('Open')}</button>
  </div>
{:else if failed.retry}
  <!-- A card carried to a column whose note would not be written: it went back. -->
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(`${t('Not moved')}. ${t('Retry')}`)}
    {@attach kept('failed')}
  >
    <p>{t('Not moved')}</p>
    <button class="undo" onclick={() => failed.again()}>{t('Retry')}</button>
  </div>
{:else if undoToast.kind}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach toldUndo(undoToast.kind)}
    {@attach kept('undo', undoToast)}
  >
    <p>{word[undoToast.kind]}</p>
    <button class="undo" onclick={() => void undoToast.undo(workspace)}>{t('Undo')}</button>
  </div>
  <!-- A row clicked that opened nothing, because the file is there and would not
       read; see unread.svelte.ts. Nothing to press: there is no way back from a
       file another program holds, only the news that it does. -->
{:else if unread.shown}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(t('That file could not be read'))}
  >
    <p>{t('That file could not be read')}</p>
  </div>
{/if}{#if back.said}
  <!-- A note this device deleted, put back because another device was writing in
       it; see sync2/resurrected.svelte.ts. Its own toast rather than a turn of the one
       above, so an Undo that is up is not taken away by it. Written against the block
       before it, because a line between two blocks is a space on the page. -->
  {@const words = t('{name} is back: {device} was writing in it', {
    name: back.said.name,
    device: back.said.device,
  })}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
    {@attach kept('back', back)}
  >
    <p>{words}</p>
  </div>
{/if}{#if unsynced.said}
  <!-- A file whose edits here do not sync: its name and its kind disagree since a
       rename. See sync2/unsynced.svelte.ts. -->
  {@const about =
    unsynced.many > 1
      ? plural(unsynced.many, { one: '{count} file', other: '{count} files' })
      : unsynced.said}
  {@const words = t('Changes to {name} are not syncing', { name: about })}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
    {@attach kept('unsynced', unsynced)}
  >
    <p>{words}</p>
  </div>
{/if}

<style>
  /* The first track of the notices row, under the file list the change was made in,
     where Gmail puts its own. Stacked under the storage warning when both are up. */
  .toast {
    grid-column: 1;
    justify-self: start;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
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

  .undo {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--accent);
    cursor: default;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .undo:active {
    opacity: 0.6;
  }

  :global([data-touch]) .undo {
    min-height: var(--touch-target);
  }
</style>
