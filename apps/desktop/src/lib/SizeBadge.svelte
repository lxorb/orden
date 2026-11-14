<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, scale } from './platform/src/api'
  import { modes } from './modes.svelte'

  const HELD = 900

  let shown = $state(false)
  let last = modes.zoom
  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const size = modes.zoom
    if (size === last) return

    last = size
    shown = true

    clearTimeout(timer)
    timer = setTimeout(() => {
      shown = false
    }, HELD)
  })

  onDestroy(() => clearTimeout(timer))

  const percent = $derived(Math.round(modes.zoom * 100))
</script>

{#if shown}
  <div
    class="size orden-pill"
    data-covers
    role="status"
    in:scale={{ duration: dur(140), start: 0.94, easing: cubicOut }}
    out:fade={{ duration: dur(180) }}
  >
    {percent}% text
  </div>
{/if}

<style>
  .size {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-4));
    left: 50%;
    translate: -50% 0;
    z-index: var(--z-notice);
  }
</style>
