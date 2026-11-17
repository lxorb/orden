<script lang="ts">
  import { whenLoaded } from '@orden/contracts'

  const { value, label }: { value: string; label: string } = $props()

  let drawn = $state<string | null>(null)

  $effect(() => {
    const text = value
    drawn = null
    if (!text) return
    return whenLoaded(
      () => import('uqr'),
      ({ renderSVG }) => (drawn = renderSVG(text, { border: 1, pixelSize: 6 })),
      () => undefined,
    )
  })
</script>

{#if drawn}
  <figure class="qr" role="img" aria-label={label}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr draws the square from the text it is given -->
    {@html drawn}
  </figure>
{/if}

<style>
  .qr {
    flex: none;
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: #fff;
    line-height: 0;
  }

  .qr :global(svg) {
    display: block;
    width: var(--qr-size, 8.5rem);
    height: var(--qr-size, 8.5rem);
  }
</style>
