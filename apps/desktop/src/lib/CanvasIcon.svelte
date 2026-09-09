<script lang="ts">
  /** One icon, drawn from the set the rest of the app is drawn from.
   *
   *  Lucide hands an icon over as a list of tags and attributes rather than as
   *  markup, so this is the one place that turns one into an `<svg>`. Sized by
   *  whatever it is in, through `--mark`, because a bar on a touch screen draws
   *  the same icon bigger and nothing about the icon itself changes. */

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
