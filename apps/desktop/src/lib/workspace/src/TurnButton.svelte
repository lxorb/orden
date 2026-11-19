<script lang="ts">
  import ArrowLeftRight from 'lucide/dist/esm/icons/arrow-left-right.mjs'

  const { title, onclick }: { title: string; onclick: () => void } = $props()
</script>

<button class="orden-glyph" {title} aria-label={title} {onclick}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each ArrowLeftRight as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</button>
