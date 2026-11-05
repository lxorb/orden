<script lang="ts">
  import ExtensionButtons from '../../src/lib/web-tab/ExtensionButtons.svelte'
  import WebExtensionPopup from '../../src/lib/web-tab/WebExtensionPopup.svelte'
  import { extensions } from '../../src/lib/web-tab/extensions.svelte'

  let opener = $state<HTMLElement | null>(null)
</script>

<ExtensionButtons
  addable={null}
  open={extensions.popped?.id ?? null}
  onpress={(id: string, anchor: HTMLElement) => {
    opener = anchor
    extensions.open(id, 'tab', null)
  }}
  onlist={() => undefined}
  onadd={() => undefined}
/>

{#if extensions.popped}
  {#key extensions.popped.id}
    <WebExtensionPopup popped={extensions.popped} right={0} from={opener} />
  {/key}
{/if}
