<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { plural, t } from './i18n.svelte'
  import { focusEditor } from './focus'
  import { dur, fly } from './motion'
  import { told } from './said.svelte'
  import { reservedName } from './reserved-name.svelte'
  import { back } from './sync2/resurrected.svelte'
  import { gateNote } from './gate-note.svelte'
  import { undoToast } from './undo-toast.svelte'
  import { unread } from './unread.svelte'
  import { unsynced } from './sync2/unsynced.svelte'
  import { failed } from './views/failed.svelte'
  import { workspace } from './workspace.svelte'

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

  undoToast.know(workspace.undone.stack)

  $effect(() => {
    const stack = workspace.undone.stack
    untrack(() => undoToast.heard(stack))
  })

  $effect(() => {
    if (undoToast.kind) untrack(() => failed.dismiss())
  })

  function toldUndo(kind: keyof typeof word) {
    return told(undoToast.batch.length ? `${word[kind]}. ${t('Undo')}` : '')
  }

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

  const up = {
    reserved: () => turn === 'reserved',
    failed: () => turn === 'failed',
    undo: () => turn === 'undo',
    back: () => !!back.said,
    gate: () => !!gateNote.said,
    unsynced: () => !!unsynced.said,
  }

  let holding: { card: HTMLElement; name: keyof typeof up; from: HTMLElement | null } | null = null

  function handBack() {
    const from = holding?.from
    holding = null
    if (from?.isConnected) from.focus({ preventScroll: true })
    if (!from || document.activeElement !== from) focusEditor()
  }

  $effect.pre(() => {
    for (const going of Object.values(up)) going()
    untrack(() => {
      if (!holding || up[holding.name]()) return
      if (holding.card.contains(document.activeElement)) handBack()
      else holding = null
    })
  })

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
        const at = document.activeElement
        if (holding?.card === card && (at === document.body || at === null || card.contains(at)))
          queueMicrotask(handBack)
      }
    }
  }

  $effect(() => () => {
    undoToast.dismiss()
    reservedName.dismiss()
    unread.dismiss()
    failed.dismiss()
    back.dismiss()
    gateNote.dismiss()
    unsynced.dismiss()
  })
</script>

{#if reservedName.root}
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
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(`${failed.undoing ? t('Not undone') : t('Not moved')}. ${t('Retry')}`)}
    {@attach kept('failed')}
  >
    <p>{failed.undoing ? t('Not undone') : t('Not moved')}</p>
    <button class="undo" onclick={() => failed.again()}>{t('Retry')}</button>
    {#if failed.skip}
      <button class="undo" onclick={() => failed.giveUp()}>{t('Skip')}</button>
    {/if}
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
{:else if unread.shown}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(t('That file could not be read'))}
  >
    <p>{t('That file could not be read')}</p>
  </div>
{/if}{#if back.said}
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
{/if}{#if gateNote.said}
  {@const words = t('{name} is turned off, so its tabs were closed', { name: gateNote.said })}
  <div
    class="toast"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    {@attach told(words)}
    {@attach kept('gate', gateNote)}
  >
    <p>{words}</p>
  </div>
{/if}{#if unsynced.said}
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
