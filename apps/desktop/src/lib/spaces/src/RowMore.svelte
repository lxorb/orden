<script lang="ts">
  const { onclick }: { onclick: (event: MouseEvent) => void } = $props()
</script>

<button
  class="orden-glyph more"
  role="menuitem"
  aria-haspopup="menu"
  title="More"
  aria-label="More"
  {onclick}
>
  <svg viewBox="0 0 13 13"
    ><circle cx="3" cy="6.5" r="1" /><circle cx="6.5" cy="6.5" r="1" /><circle
      cx="10"
      cy="6.5"
      r="1"
    /></svg
  >
</button>

<style>
  .more {
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    :global(.line:hover) > .more,
    .more:focus-visible {
      opacity: 1;
    }
  }

  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }

  .more svg {
    fill: currentColor;
    stroke: none;
  }

  .more:focus-visible {
    outline-offset: -1px;
  }
</style>
