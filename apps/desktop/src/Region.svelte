<script lang="ts">
  import type { Snippet } from 'svelte'
  import { log } from './lib/platform/src/api'

  const { name, children }: { name: string; children: Snippet } = $props()
  const SETTLE = 1000
  let rebuiltAt = -SETTLE
  let rebuilding = false
  let lost = $state(false)
  function failed(error: unknown, reset: () => void) {
    log('error', `${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    if (rebuilding) return
    if (performance.now() - rebuiltAt < SETTLE) {
      lost = true
      return
    }
    rebuilding = true
    queueMicrotask(() => {
      rebuilding = false
      rebuiltAt = performance.now()
      reset()
    })
  }
</script>

{#if lost}
  <div class="lost" role="alert" data-lost={name}>
    <button class="orden-button" onclick={() => location.reload()}>Reload</button>
  </div>
{:else}
  <svelte:boundary onerror={failed}>
    {@render children()}
  </svelte:boundary>
{/if}

<style>
  .lost {
    flex: 1;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
</style>
