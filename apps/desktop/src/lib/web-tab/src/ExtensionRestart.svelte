<script lang="ts">
  import { extensions, OFF_SAID, type Extension } from './extensions.svelte'

  const { one }: { one: Extension } = $props()
</script>

<div class="restart">
  {#if !one.enabled}
    <p class="why">{OFF_SAID}</p>
  {/if}
  {#if one.problem}
    <p class="why">{one.problem}</p>
  {/if}
  <button class="orden-chip" onclick={() => void extensions.restart()}>
    {one.enabled ? `Restart Orden to finish installing ${one.name}` : `Restart Orden to turn off ${one.name}`}
  </button>
</div>

<style>
  .restart {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
  }
  .why {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
</style>
