<script lang="ts">
  import type { IconNode } from '../icons'

  const { icon, class: kind = '' }: { icon: IconNode; class?: string } = $props()
</script>

<svg class={kind || undefined} viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs] (JSON.stringify(attrs))}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
