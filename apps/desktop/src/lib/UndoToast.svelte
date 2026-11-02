<script lang="ts">
  import { untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { focusEditor } from './focus'
  import { dur } from './motion'
  import { said as spoken } from './said.svelte'
  import { reservedName } from './reserved-name.svelte'
  import { back } from './sync2/resurrected.svelte'
  import { undoToast } from './undo-toast.svelte'
  import { unread } from './unread.svelte'
  import { unsynced } from './sync2/unsynced.svelte'
  import { failed } from './views/failed.svelte'
  import { workspace } from './workspace.svelte'

  /** The one word for each thing the toast can take back. */
  const said = $derived({
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

  // Said through the region that was on the page first, and not by a region arriving
  // with its words, which most readers never announce; see said.svelte.ts (#523). Each
  // action that joins the Undo is said again, though the words are the same.
  $effect(() => {
    if (undoToast.batch.length && undoToast.kind)
      spoken.say(`${said[undoToast.kind]}. ${t('Undo')}`)
  })
  $effect(() => {
    if (failed.retry) spoken.say(`${t('Not moved')}. ${t('Retry')}`)
  })
  $effect(() => {
    if (reservedName.root) spoken.say(t("AGENTS is this space's agent instructions"))
  })
  $effect(() => {
    if (unread.shown) spoken.say(t('That file could not be read'))
  })
  $effect(() => {
    if (back.said)
      spoken.say(
        t('{name} is back: {device} was writing in it', {
          name: back.said.name,
          device: back.said.device,
        }),
      )
  })
  $effect(() => {
    if (unsynced.said) spoken.say(t('Changes to {name} are not syncing', { name: unsynced.said }))
  })

  /** Whether a hand or the keyboard is on the Undo: either holds it against the clock,
   *  and it lingers only once both have gone. */
  let handOn = false
  let keysOn = false

  function rest() {
    if (!handOn && !keysOn) undoToast.linger()
  }

  /** The keyboard, handed back to where it came from as a card goes from under it: by
   *  its own Undo, or by Ctrl+Z pressed on it. */
  function handsBack(card: HTMLElement) {
    let from: HTMLElement | null = null

    const entered = (event: FocusEvent) => {
      const came = event.relatedTarget
      if (came instanceof HTMLElement && !card.contains(came)) from = came
    }
    const left = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !card.contains(event.relatedTarget)) from = null
    }
    card.addEventListener('focusin', entered)
    card.addEventListener('focusout', left)

    return {
      destroy() {
        const at = document.activeElement
        if (!from || (at !== document.body && at !== null && !card.contains(at))) return
        const back = from
        // After the card has left the page, or a press there has nothing to land on.
        queueMicrotask(() => {
          // In the page and out of reach is the same: a side shut since says nothing else.
          if (back.isConnected) back.focus({ preventScroll: true })
          if (document.activeElement !== back) focusEditor()
        })
      },
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
    data-region="notices"
    use:handsBack
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
  >
    <p>{t("AGENTS is this space's agent instructions")}</p>
    <button class="undo" onclick={() => reservedName.open()}>{t('Open')}</button>
  </div>
{:else if failed.retry}
  <!-- A card carried to a column whose note would not be written: it went back. -->
  <div
    class="toast"
    data-region="notices"
    use:handsBack
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
  >
    <p>{t('Not moved')}</p>
    <button class="undo" onclick={() => failed.again()}>{t('Retry')}</button>
  </div>
{:else if undoToast.kind}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="toast"
    data-region="notices"
    use:handsBack
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    onpointerenter={() => {
      handOn = true
      undoToast.hold()
    }}
    onpointerleave={() => {
      handOn = false
      rest()
    }}
    onfocusin={() => {
      keysOn = true
      undoToast.hold()
    }}
    onfocusout={() => {
      keysOn = false
      rest()
    }}
  >
    <p>{said[undoToast.kind]}</p>
    <button class="undo" onclick={() => void undoToast.undo(workspace)}>{t('Undo')}</button>
  </div>
  <!-- A row clicked that opened nothing, because the file is there and would not
       read; see unread.svelte.ts. Nothing to press: there is no way back from a
       file another program holds, only the news that it does. -->
{:else if unread.shown}
  <div class="toast" transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}>
    <p>{t('That file could not be read')}</p>
  </div>
{/if}{#if back.said}
  <!-- A note this device deleted, put back because another device was writing in
       it; see sync2/resurrected.svelte.ts. Its own toast rather than a turn of the one
       above, so an Undo that is up is not taken away by it. Written against the block
       before it, because a line between two blocks is a space on the page. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    onpointerenter={() => back.hold()}
    onpointerleave={() => back.linger()}
  >
    <p>
      {t('{name} is back: {device} was writing in it', {
        name: back.said.name,
        device: back.said.device,
      })}
    </p>
  </div>
{/if}{#if unsynced.said}
  <!-- A file whose edits here do not sync: its name and its kind disagree since a
       rename. See sync2/unsynced.svelte.ts. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    onpointerenter={() => unsynced.hold()}
    onpointerleave={() => unsynced.linger()}
  >
    <p>{t('Changes to {name} are not syncing', { name: unsynced.said })}</p>
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
