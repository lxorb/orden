<script lang="ts">
  import { renderMarkdown } from '@orden/markdown'
  import { openExternal } from '../../platform/src/api'
  import { Sheet } from '../../ui-controls/src/api'
  import { RELEASES_URL } from './links'

  const { version, notes, onclose }: { version: string; notes: string; onclose: () => void } = $props()
  const shown = $derived(renderMarkdown(notes, { escapeHtml: true }))
</script>

<Sheet open title="What's new in Orden {version}" {onclose}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the release's own notes, escaped as markdown is drawn -->
  <div class="notes">{@html shown}</div>

  {#snippet foot()}
    <button class="orden-button is-quiet" onclick={() => void openExternal(`${RELEASES_URL}/tag/v${version}`)}>
      Open on GitHub
    </button>
    <button class="orden-button" onclick={onclose}>Done</button>
  {/snippet}
</Sheet>

<style>
  .notes {
    font-size: var(--text-row);
    line-height: 1.55;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .notes :global(h3) {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }
  .notes :global(p) {
    margin: 0 0 var(--space-2);
  }
  .notes :global(ul) {
    margin: 0;
    padding-inline-start: 1.2em;
  }
  .notes :global(li) {
    margin-bottom: var(--space-1);
  }
</style>
