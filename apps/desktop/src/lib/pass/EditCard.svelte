<script lang="ts">
  import type { Snippet } from 'svelte'

  const { title, children }: { title?: string; children: Snippet } = $props()
</script>

{#if title}<h3 class="nib-section">{title}</h3>{/if}
<div class="card">
  {@render children()}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .nib-section {
    margin: var(--space-2) 0 0;
  }
</style>
