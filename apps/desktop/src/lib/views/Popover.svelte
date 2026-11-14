<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../ui-kit/src/api'
  import { fly, LAYER } from '../platform/src/api'
  import { overlays } from '../ui-kit/src/api'

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
    start?: boolean
  } = $props()

  let layer = $state<HTMLElement>()

  $effect(() => closeOnBack(open, onclose))
  $effect(() =>
    open
      ? overlays.show(onclose, () => [
          layer,
          ...document.querySelectorAll(
            '[data-opens-popover], .orden-layer, [role=listbox], [role=menu]',
          ),
        ])
      : undefined,
  )
</script>

{#if open}
  <div
    class="pop orden-layer"
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
