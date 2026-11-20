<script lang="ts">
  import { foreignCopy } from '@orden/sync-core'
  import CloudOff from 'lucide/dist/esm/icons/cloud-off.mjs'
  import { SharedMark } from '../../ui-kit/src/api'
  import { nameOf } from '../../platform/src/api'

  const { path }: { path: string | null } = $props()
  const copy = $derived(path === null ? null : foreignCopy(nameOf(path)))
  function fades(mark: HTMLElement) {
    let label = mark.previousElementSibling
    while (label && !label.classList.contains('orden-row-label')) label = label.previousElementSibling
    const faded = [label, label?.previousElementSibling].filter((one) => one instanceof HTMLElement)
    for (const one of faded) one.style.opacity = '0.5'
    return () => {
      for (const one of faded) one.style.removeProperty('opacity')
    }
  }
</script>

{#if copy}
  <span class="foreign" {@attach fades}>
    <SharedMark label="{copy.tool} conflict copy, not synced" icon={CloudOff} />
  </span>
{/if}

<style>
  .foreign {
    display: contents;
  }
</style>
