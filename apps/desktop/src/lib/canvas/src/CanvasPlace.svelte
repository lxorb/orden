<script lang="ts">
  import { Glyph, tick } from '../../ui-controls/src/api'
  import { isShape } from '@orden/markdown/canvas'
  import { hinted, PLACING } from './glyphs'
  import { type Tool } from './pointer'
  import { tools } from './tools.svelte'

  const { onchoose }: { onchoose: (tool: Tool) => void } = $props()

  const firstShape = $derived(PLACING.findIndex((one) => isShape(one.id)))
</script>

<div class="place">
  {#each PLACING as one, index (one.id)}
    {#if index === firstShape}
      <span class="split"></span>
    {/if}

    <button
      type="button"
      class:on={tools.which === one.id}
      title={hinted(one)}
      aria-label={one.title()}
      aria-pressed={tools.which === one.id}
      onclick={() => {
        tick()
        onchoose(one.id)
      }}
    >
      <Glyph node={one.icon} />
      <span>{one.title()}</span>
    </button>
  {/each}
</div>

<style>
  .place {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
  }

  .split {
    grid-column: 1 / -1;
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--line);
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 34px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button:active {
    background: var(--press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
