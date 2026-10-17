<script lang="ts">
  /** A small layer under a button of a view's head: the filter, the sort, the group.
   *  `.nib-layer`, rising the way every layer of the app rises (motion.ts), closed by
   *  Escape, by a press outside it, and on a phone by back. */
  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../backstack.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'

  const {
    open,
    onclose,
    label,
    children,
    start = false,
  }: {
    open: boolean
    onclose: () => void
    label: string
    children: Snippet
    /** Hung from the start of what opened it rather than its end. */
    start?: boolean
  } = $props()

  let layer = $state<HTMLElement>()

  $effect(() => closeOnBack(open, onclose))
  // Closed by a press past it and by the window losing the focus, as every popup is;
  // see overlays.ts. A press on what opened it is that button's own: it closes it by
  // itself. And a menu or a list a control in here dropped is part of what is being
  // chosen.
  $effect(() =>
    open
      ? overlays.show(onclose, () => [
          layer,
          ...document.querySelectorAll(
            '[data-opens-popover], .nib-layer, [role=listbox], [role=menu]',
          ),
        ])
      : undefined,
  )
</script>

{#if open}
  <div
    class="pop nib-layer"
    class:start
    bind:this={layer}
    role="dialog"
    aria-label={label}
    tabindex="-1"
    transition:fly={{ y: 6, duration: LAYER.rise, easing: cubicOut }}
    onkeydown={(event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onclose()
    }}
  >
    {@render children()}
  </div>
{/if}

<style>
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline-end: 0;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(440px, calc(100vw - 32px));
    max-height: min(60vh, 520px);
    padding: var(--space-3);
    overflow-y: auto;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .pop.start {
    inset-inline-end: auto;
    inset-inline-start: 0;
  }
</style>
