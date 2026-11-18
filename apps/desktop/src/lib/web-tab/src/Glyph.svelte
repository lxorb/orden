<script lang="ts">
  import type { IconNode } from 'lucide'

  const { icon }: { icon: IconNode } = $props()
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs], index (index)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>
