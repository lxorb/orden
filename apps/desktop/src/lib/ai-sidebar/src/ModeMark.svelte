<script lang="ts">
  import type { Mode } from '../../ai-providers/src/api'
  import { MODE_ICONS } from './mode-icons'

  const { mode }: { mode: Mode } = $props()
</script>

<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" data-mode={mode}>
  {#each MODE_ICONS[mode] as [tag, attrs], index (index)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  .mark {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
