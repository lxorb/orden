<script lang="ts">
  /** How the lasso catches: a loop drawn round it, or a box pulled out over it.
   *
   *  A loop is what a hand does over a sketch, where what you want is nowhere near
   *  rectangular. A box is what a hand does over handwriting, where three lines of
   *  it are a rectangle and drawing round them is work. Both, and the one you used
   *  last is the one you get.
   *
   *  And whether a stroke it only half caught counts. Off, so a loop round a word
   *  never drags away half of the word beside it; on for anybody pulling a box over
   *  a paragraph, where the long strokes always poke out. */

  import { pens } from './canvas/pens.svelte'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const WAYS = [
    { box: false, word: () => t('Lasso') },
    { box: true, word: () => t('Rectangle') },
  ] as const
</script>

<div class="catch">
  <div class="nib-segmented">
    {#each WAYS as one (one.box)}
      <button
        type="button"
        class:on={pens.box === one.box}
        title={one.word()}
        aria-label={one.word()}
        aria-pressed={pens.box === one.box}
        onclick={() => {
          tick()
          pens.catching({ box: one.box })
        }}
      >
        {one.word()}
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="partly"
    class:on={pens.partly}
    title={t('Include what it touches')}
    aria-label={t('Include what it touches')}
    aria-pressed={pens.partly}
    onclick={() => {
      tick()
      pens.catching({ partly: !pens.partly })
    }}
  >
    {t('Include what it touches')}
  </button>
</div>

<style>
  .catch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .partly {
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

  .partly:active {
    background: var(--press);
  }

  .partly.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  :global([data-touch]) .partly {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
