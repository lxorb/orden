<script lang="ts">
  const { small = false }: { small?: boolean } = $props()
</script>

{#if small}
  <svg class="nib-cross" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" /></svg>
{:else}
  <svg class="nib-cross" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg
  >
{/if}

<style>
  .nib-cross {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
