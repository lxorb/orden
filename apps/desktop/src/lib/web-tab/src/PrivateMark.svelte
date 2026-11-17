<script lang="ts">
  import HatGlasses from 'lucide/dist/esm/icons/hat-glasses.mjs'
  import { dur, fade } from '../../platform/src/api'

  const { large = false }: { large?: boolean } = $props()
</script>

<svg
  class="private"
  class:large
  viewBox="0 0 24 24"
  role="img"
  aria-label="Private"
  transition:fade={{ duration: dur(140) }}
>
  <title>Private</title>
  {#each HatGlasses as [tag, attrs], at (at)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  .private {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }

  .large {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 1.6;
  }
</style>
