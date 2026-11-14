<script lang="ts">
  import { extensions, GAP_WORDS, type Gaps } from './extensions.svelte'

  const { gaps, asking = false }: { gaps: Gaps; asking?: boolean } = $props()
</script>

<div class="gaps" role={asking ? 'alert' : undefined}>
  <p>Not all of it works in Orden:</p>
  <ul>
    {#each gaps.said.filter((one) => one in GAP_WORDS) as one (one)}
      <li>{GAP_WORDS[one] ?? ''}</li>
    {/each}
    {#if gaps.apis.length}
      <li>
        Firefox-only parts it uses that don’t run here: {gaps.apis.join(', ')}
      </li>
    {/if}
  </ul>
  {#if asking && extensions.asking}
    {@const link = extensions.asking.link}
    <div class="choices">
      <button class="orden-chip" onclick={() => void extensions.install(link, true)}>
        Install anyway
      </button>
      <button class="orden-chip is-quiet" onclick={() => (extensions.asking = null)}>
        Cancel
      </button>
    </div>
  {/if}
</div>

<style>
  .gaps {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  p,
  ul {
    margin: 0;
  }

  ul {
    padding-inline-start: var(--space-3);
    color: var(--muted-strong);
  }

  .choices {
    display: flex;
    gap: var(--space-2);
    padding-block: var(--space-1);
  }
</style>
