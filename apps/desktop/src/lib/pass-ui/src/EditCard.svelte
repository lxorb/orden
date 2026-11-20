<script lang="ts">
  import type { Snippet } from 'svelte'

  const { title, children }: { title?: string; children: Snippet } = $props()
</script>

{#if title}<h3 class="orden-section">{title}</h3>{/if}
<div class="pass-stack">
  {@render children()}
</div>

<style>
  .pass-stack > :global(:not(:first-child)) {
    border-top: 1px solid var(--line);
  }
  .orden-section {
    margin: var(--space-2) 0 0;
  }
</style>
