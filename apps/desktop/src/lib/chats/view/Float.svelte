<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../../backstack.svelte'
  import { fly, LAYER } from '../../platform/src/api'
  import { overlays } from '../../overlays'
  import { viewport } from '../../viewport.svelte'
  import { type Box, placeNear } from './place'

  const {
    at,
    end = false,
    label,
    width = 'auto',
    onclose,
    children,
  }: {
    at: Box | null
    end?: boolean
    label: string
    width?: string
    onclose: () => void
    children: Snippet
  } = $props()

  let layer = $state<HTMLElement>()
  let measuredWidth = $state(0)
  let measuredHeight = $state(0)

  const sheet = $derived(viewport.device === 'phone')
  const place = $derived(
    at
      ? placeNear(
          at,
          { width: measuredWidth, height: measuredHeight },
          { width: window.innerWidth, height: window.innerHeight },
          end,
        )
      : { left: 0, top: 0 },
  )

  $effect(() => (at ? overlays.show(onclose, () => [layer]) : undefined))
  $effect(() => closeOnBack(!!at, onclose))
</script>

{#if at}
  <div
    class="float orden-layer"
    class:sheet
    bind:this={layer}
    bind:clientWidth={measuredWidth}
    bind:clientHeight={measuredHeight}
    style:left={sheet ? undefined : `${place.left}px`}
    style:top={sheet ? undefined : `${place.top}px`}
    style:--float-width={width}
    role="dialog"
    aria-label={label}
    tabindex="-1"
    transition:fly={{ y: sheet ? 24 : 6, duration: LAYER.rise, easing: cubicOut }}
  >
    {@render children()}
  </div>
{/if}

<style>
  .float {
    position: fixed;
    z-index: var(--z-menu);
    width: var(--float-width);
    max-width: calc(100vw - 16px);
    max-height: min(420px, calc(100dvh - 16px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--text);
  }

  .float.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-width: none;
    max-height: 70dvh;
    padding-bottom: var(--inset-bottom);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
</style>
