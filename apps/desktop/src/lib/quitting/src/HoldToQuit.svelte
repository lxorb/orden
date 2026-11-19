<script lang="ts">
  import { fade, LAYER } from '../../platform/src/api'
  import { holding } from './state.svelte'
</script>

{#if holding.shown}
  <div class="orden-layer hold" role="status" transition:fade={{ duration: LAYER.fade }}>Hold ⌘Q to quit</div>
{/if}

<style>
  .hold {
    position: fixed;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    z-index: var(--z-sheet);
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    pointer-events: none;
  }
</style>
