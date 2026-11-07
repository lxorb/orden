<script lang="ts">
  import { foreignCopy } from '@orden/sync-core/foreign'
  import CloudOff from 'lucide/dist/esm/icons/cloud-off.mjs'
  import { t } from '../i18n.svelte'
  import SharedMark from '../SharedMark.svelte'
  import { nameOf } from '../space-paths'

  const { path }: { path: string | null } = $props()

  const copy = $derived(path === null ? null : foreignCopy(nameOf(path)))
</script>

{#if copy}
  <span class="foreign">
    <SharedMark
      label={t('{tool} conflict copy · not synced', { tool: copy.tool })}
      icon={CloudOff}
    />
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
