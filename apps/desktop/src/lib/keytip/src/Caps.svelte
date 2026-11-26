<script lang="ts">
  import { capsOf } from './caps'

  const { shown }: { shown: string } = $props()
  const caps = $derived(capsOf(shown))
</script>

<span class="caps">
  {#each caps as cap, at (at)}<kbd>{cap}</kbd>{/each}
</span>

<style>
  .caps {
    flex: none;
    display: inline-flex;
    gap: 3px;
    margin-inline-start: auto;
    padding-inline-start: var(--space-3);
    color: var(--muted);
  }
  kbd {
    min-width: 1.6em;
    padding: 0 0.35em;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent);
    background: color-mix(in srgb, currentColor 7%, transparent);
    color: inherit;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: normal;
    line-height: 1.55;
    text-align: center;
  }
</style>
