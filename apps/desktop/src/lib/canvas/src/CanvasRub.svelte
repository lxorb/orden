<script lang="ts">
  import CanvasDial from './CanvasDial.svelte'
  import { LEAST_RUB, MOST_RUB, pens } from './pens.svelte'
  import { tick } from '../../ui-controls/src/api'

  const { onerase }: { onerase: () => void } = $props()

  const WAYS = [
    { whole: true, word: () => 'Stroke', title: () => 'A whole stroke at a touch' },
    { whole: false, word: () => 'Area', title: () => 'Only what is under the nib' },
  ] as const

  const wide = $derived(pens.whole ? pens.strokeRub : pens.rub)

  function way(whole: boolean) {
    tick()
    pens.rubbing({ whole })
  }
</script>

<div class="rub">
  <div class="orden-segmented">
    {#each WAYS as one (one.whole)}
      <button
        type="button"
        class:on={pens.whole === one.whole}
        title={one.title()}
        aria-label={one.title()}
        aria-pressed={pens.whole === one.whole}
        onclick={() => way(one.whole)}
      >
        {one.word()}
      </button>
    {/each}
  </div>

  <div class="wide">
    <span class="ring" style:width="{wide * 2}px" style:height="{wide * 2}px"></span>

    <CanvasDial
      value={wide}
      least={LEAST_RUB}
      most={MOST_RUB}
      step={2}
      label="Width"
      reading={String(wide)}
      onvalue={(rub: number) => pens.rubbing(pens.whole ? { strokeRub: rub } : { rub })}
    />
  </div>

  <button
    type="button"
    class="all"
    title="Erase everything drawn"
    aria-label="Erase everything drawn"
    onclick={() => {
      tick()
      onerase()
    }}
  >
    Everything
  </button>
</div>

<style>
  .rub {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .wide {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .wide :global(.dial) {
    flex: 1;
    min-width: 0;
  }

  .ring {
    flex: none;
    box-sizing: border-box;
    max-width: 68px;
    max-height: 68px;
    border-radius: 50%;
    border: 1.5px dashed var(--muted);
    background: var(--surface-2);
    transition:
      width var(--dur-fast) var(--ease-out),
      height var(--dur-fast) var(--ease-out);
  }

  .all {
    min-height: 34px;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .all:active {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
  }

  :global([data-touch]) .all {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
