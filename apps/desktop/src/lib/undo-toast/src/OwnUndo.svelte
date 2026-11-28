<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { undoToast } from './undo-toast.svelte'

  function undo() {
    const own = undoToast.own
    undoToast.dismiss()
    void own?.undo()
  }
  const WORDS = { done: 'Done', scheduled: 'Changed', moved: 'Moved', deleted: 'Deleted' }
  const said = $derived(undoToast.own?.said ?? null)
</script>

{#if said}
  <div
    class="undo"
    role="status"
    data-own-undo
    transition:fly={{ y: 24, duration: dur(180), easing: cubicOut }}
    onpointerenter={() => undoToast.hold()}
    onpointerleave={() => undoToast.linger()}
  >
    <span>{WORDS[said]}</span>
    <button type="button" class="orden-chip" data-undo-run onclick={undo}>Undo</button>
  </div>
{/if}

<style>
  .undo {
    position: fixed;
    left: var(--space-4);
    right: var(--space-4);
    bottom: calc(var(--inset-bottom, 0px) + 76px);
    z-index: var(--z-sheet);
    max-width: 28rem;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-radius: 16px;
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow-lg);
    font-weight: 600;
  }
  .undo button {
    min-width: 64px;
    min-height: var(--touch-target);
    border: none;
    background: var(--bg);
    color: var(--text);
    font-weight: 650;
  }
</style>
