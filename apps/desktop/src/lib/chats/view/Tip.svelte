<script lang="ts">
  import { dur, fade } from '../../platform/src/api'
  import { tips } from './tips.svelte'

  let width = $state(0)
  let height = $state(0)

  const place = $derived.by(() => {
    const shown = tips.shown
    if (!shown) return { left: 0, top: 0 }
    const middle = (shown.at.left + shown.at.right) / 2
    const left = Math.min(Math.max(8, middle - width / 2), window.innerWidth - width - 8)
    const above = shown.at.top - height - 6
    return { left, top: above < 8 ? shown.at.bottom + 6 : above }
  })
</script>

{#if tips.shown}
  <div
    class="tip orden-bubble"
    role="tooltip"
    bind:clientWidth={width}
    bind:clientHeight={height}
    style:left="{place.left}px"
    style:top="{place.top}px"
    transition:fade={{ duration: dur(100) }}
  >
    {tips.shown.text}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: var(--z-menu);
    white-space: pre-line;
  }
</style>
