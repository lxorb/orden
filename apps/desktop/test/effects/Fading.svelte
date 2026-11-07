<script lang="ts">
  import { fade } from '../../src/lib/motion'

  const { ended }: { ended: () => void } = $props()

  let shown = $state(true)

  export function hide() {
    shown = false
  }
</script>

{#if shown}
  <p transition:fade={{ duration: 200 }} onoutroend={ended}></p>
{/if}
