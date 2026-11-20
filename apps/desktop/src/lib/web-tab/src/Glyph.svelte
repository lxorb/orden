<script lang="ts">
  import type { IconNode } from 'lucide'

  const { icon }: { icon: IconNode } = $props()
</script>

<svg class="orden-web-glyph" viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs], index (index)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  :global(:where(svg.orden-web-glyph)) {
    display: block;
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
