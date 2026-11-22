<script lang="ts">
  import { untrack } from 'svelte'
  import { focusEditor } from './focus'
  import { toastDoor } from '../../ui-kit/src/api'
  import { back, unsynced } from '../../sync-client/src/api'
  import { undoToast } from '../../undo-toast/src/api'
  import { failed, gateNote, reservedName, unread } from './notices.svelte'
  import { workspace } from './workspace.svelte'

  const word = $derived({
    delete: 'Deleted',
    move: 'Moved',
    archive: 'Archived',
    unarchive: 'Unarchived',
    done: 'Completed',
    scheduled: 'Scheduled',
    moved: 'Moved',
    deleted: 'Deleted',
  })
  const Toast = $derived(toastDoor.one)
  void toastDoor.ask()
  undoToast.know(workspace.undone.stack)
  $effect(() => {
    const stack = workspace.undone.stack
    untrack(() => undoToast.heard(stack))
  })
  $effect(() => {
    if (undoToast.kind) untrack(() => failed.dismiss())
  })
  const turn = $derived(
    reservedName.root ? 'reserved' : failed.retry ? 'failed' : undoToast.kind ? 'undo' : unread.shown ? 'unread' : null,
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

{#if Toast}
  {#if reservedName.root}
    <Toast
      words="AGENTS is this space's agent instructions"
      actions={[{ label: 'Open', run: () => reservedName.open() }]}
      ongone={() => reservedName.dismiss()}
      {@attach kept('reserved')}
    />
  {:else if failed.retry}
    <Toast
      words={failed.undoing ? 'Not undone' : 'Not moved'}
      said={() => `${failed.undoing ? 'Not undone' : 'Not moved'}. Retry`}
      actions={[
        { label: 'Retry', run: () => failed.again() },
        ...(failed.skip ? [{ label: 'Skip', run: () => failed.giveUp() }] : []),
      ]}
      ongone={() => failed.dismiss()}
      {@attach kept('failed')}
    />
  {:else if undoToast.kind}
    <Toast
      words={word[undoToast.kind]}
      said={() => (undoToast.kind ? `${word[undoToast.kind]}. Undo` : '')}
      actions={[{ label: 'Undo', run: () => void undoToast.undo(workspace) }]}
      ongone={() => undoToast.dismiss()}
      {@attach kept('undo', undoToast)}
    />
  {:else if unread.shown}
    <Toast words="That file could not be read" ongone={() => unread.dismiss()} />
  {/if}{#if back.said}
    <Toast
      words={`${back.said.name} is back: ${back.said.device} was writing in it`}
      ongone={() => back.dismiss()}
      {@attach kept('back', back)}
    />
  {/if}{#if gateNote.said}
    <Toast words={gateNote.said} ongone={() => gateNote.dismiss()} {@attach kept('gate', gateNote)} />
  {/if}{#if unsynced.said}
    {@const about = unsynced.many > 1 ? `${unsynced.many} files` : unsynced.said}
    <Toast
      words={`Changes to ${about} are not syncing`}
      ongone={() => unsynced.dismiss()}
      {@attach kept('unsynced', unsynced)}
    />
  {/if}
{/if}
