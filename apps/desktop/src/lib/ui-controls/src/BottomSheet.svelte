<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, fly } from '../../platform/src/api'
  import { closeOnBack, overlays } from '../../ui-kit/src/api'
  import { pullsAway } from './sheet-pull'
  import { trap } from './trap'

  const { open, label, onclose, children }: { open: boolean; label: string; onclose: () => void; children: Snippet } =
    $props()
  $effect(() => (open ? overlays.show(onclose) : undefined))
  $effect(() => closeOnBack(open, onclose))
  function escaped(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onclose()
  }
</script>

{#if open}
  <button
    type="button"
    class="shade"
    aria-label="Close"
    tabindex="-1"
    transition:fade={{ duration: dur(160) }}
    onclick={onclose}
  ></button>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    data-track-sheet
    data-covers
    tabindex="-1"
    onkeydown={escaped}
    use:trap
    use:pullsAway={onclose}
    transition:fly={{ y: 320, duration: dur(220), easing: cubicOut }}
  >
    <span class="grip" aria-hidden="true"></span>
    {@render children()}
  </div>
{/if}

<style>
  .shade {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    border: none;
    padding: 0;
    background: rgb(0 0 0 / 0.4);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    z-index: var(--z-sheet);
    max-width: 640px;
    max-height: calc(80% - var(--keyboard, 0px));
    margin: 0 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-2) var(--space-4) max(var(--space-4), var(--inset-bottom, 0px));
    border-radius: 24px 24px 0 0;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }
  .grip {
    display: block;
    width: 36px;
    height: 4px;
    margin: var(--space-1) auto var(--space-3);
    border-radius: 2px;
    background: var(--line);
  }
</style>
