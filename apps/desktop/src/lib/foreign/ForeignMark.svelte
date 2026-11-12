<script lang="ts">
  import { foreignCopy } from '@orden/sync-core'
  import CloudOff from 'lucide/dist/esm/icons/cloud-off.mjs'
  import SharedMark from '../SharedMark.svelte'
  import { nameOf } from '../space-paths'

  const { path }: { path: string | null } = $props()

  const copy = $derived(path === null ? null : foreignCopy(nameOf(path)))
</script>

{#if copy}
  <span class="foreign">
    <SharedMark label="{copy.tool} conflict copy, not synced" icon={CloudOff} />
  </span>
{/if}

<style>
  .foreign {
    display: contents;
  }

  :global(:is(.orden-row-label, :has(+ .orden-row-label)):has(~ .foreign)) {
    opacity: 0.5;
  }
</style>
