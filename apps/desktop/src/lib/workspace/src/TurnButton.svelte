<script lang="ts">
  import ArrowLeftRight from 'lucide/dist/esm/icons/arrow-left-right.mjs'

  const { label, tip, onclick }: { label: string; tip: (node: HTMLElement) => () => void; onclick: () => void } =
    $props()
</script>

<button class="orden-glyph" {@attach tip} aria-label={label} {onclick}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each ArrowLeftRight as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</button>
