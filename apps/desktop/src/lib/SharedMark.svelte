<script lang="ts">
  import type { IconNode } from 'lucide'
  import Users from 'lucide/dist/esm/icons/users.mjs'

  const { label = 'Shared', icon = Users }: { label?: string; icon?: IconNode } = $props()
</script>

<span class="shared" title={label} aria-label={label} role="img">
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each icon as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</span>

<style>
  .shared {
    flex: none;
    display: grid;
    place-items: center;
    margin-inline-start: var(--space-1);
    color: var(--muted);
  }

  .shared svg {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
