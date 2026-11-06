<script lang="ts">
  import WebTab from '../../src/lib/web-tab/WebTab.svelte'
  import { workspace } from '../../src/lib/workspace.svelte'

  const tab = $derived(workspace.active)
</script>

{#if tab?.kind === 'web'}
  {#key tab.id}
    <WebTab {tab} focused />
  {/key}
{/if}
