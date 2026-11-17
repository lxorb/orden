<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, scale as growing } from '../../platform/src/api'

  const { zoom }: { zoom: number } = $props()

  const HELD = 600

  let shown = $state(false)
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const now = zoom
    if (!last) {
      last = now
      return
    }
    if (now === last) return

    last = now
    shown = true

    clearTimeout(timer)
    timer = setTimeout(() => {
      shown = false
    }, HELD)
  })

  onDestroy(() => clearTimeout(timer))

  const percent = $derived(Math.round(zoom * 100))
</script>

{#if shown}
  <div
    class="zoom orden-pill"
    role="status"
    in:growing={{ duration: dur(120), start: 0.94, easing: cubicOut }}
    out:fade={{ duration: dur(180) }}
  >
    {percent}%
  </div>
{/if}

<style>
  .zoom {
    position: absolute;
    top: var(--space-3);
    left: 50%;
    translate: -50% 0;
    z-index: var(--z-bars);
  }
</style>
