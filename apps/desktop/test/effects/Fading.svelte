<script lang="ts">
  /** A line that leaves with a transition, for animations.effect.test.ts. */
  import { fade } from 'svelte/transition'

  const { ended }: { ended: () => void } = $props()

  let shown = $state(true)

  /** Starts the line's outro. */
  export function hide() {
    shown = false
  }
</script>

{#if shown}
  <p transition:fade={{ duration: 200 }} onoutroend={ended}></p>
{/if}
