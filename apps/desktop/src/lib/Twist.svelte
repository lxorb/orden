<script lang="ts">
  const { open }: { open: boolean } = $props()
</script>

<svg class="turn" class:open viewBox="0 0 8 8" aria-hidden="true"><path d="M2 1l3 3-3 3" /></svg>

<style>
  .turn {
    width: 100%;
    height: 100%;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-base) var(--ease-out);
  }

  .turn.open {
    transform: rotate(90deg);
  }
</style>
