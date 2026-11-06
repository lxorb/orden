<script lang="ts">
  import type { IconNode } from 'lucide'

  const { node }: { node: IconNode } = $props()
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
  {#each node as [tag, attrs], index (index)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  svg {
    flex: none;
    width: var(--mark, 18px);
    height: var(--mark, 18px);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
