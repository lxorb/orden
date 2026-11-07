<script lang="ts">
  import type { IconNode } from 'lucide'

  const { icon, class: kind = '' }: { icon: IconNode; class?: string } = $props()
</script>

<svg class="glyph {kind}" viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs], index (index)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  .glyph {
    display: block;
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
