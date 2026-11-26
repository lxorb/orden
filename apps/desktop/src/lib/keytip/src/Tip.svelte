<script lang="ts">
  import { dur, fade } from '../../platform/src/api'
  import Caps from './Caps.svelte'
  import { tip } from './tips.svelte'

  let width = $state(0)
  let height = $state(0)
  const place = $derived.by(() => {
    const shown = tip.shown
    if (!shown) return { left: 0, top: 0 }
    const middle = (shown.at.left + shown.at.right) / 2
    const left = Math.min(Math.max(8, middle - width / 2), window.innerWidth - width - 8)
    const below = shown.at.bottom + 6
    return { left, top: below + height > window.innerHeight - 8 ? shown.at.top - height - 6 : below }
  })
</script>

{#if tip.shown}
  <div
    class="tip orden-bubble"
    role="tooltip"
    bind:clientWidth={width}
    bind:clientHeight={height}
    style:left="{place.left}px"
    style:top="{place.top}px"
    transition:fade={{ duration: dur(90) }}
  >
    <span class="label">{tip.shown.label}</span>
    {#if tip.shown.keys}<Caps shown={tip.shown.keys} />{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    pointer-events: none;
  }
  .label {
    white-space: pre-line;
  }
</style>
