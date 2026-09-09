<script lang="ts">
  /** How the eraser is set: what it takes, and how much of it.
   *
   *  Two ways of rubbing out, and they are different tools rather than degrees of
   *  one. A whole stroke goes at a touch, which is what you want over handwriting:
   *  one letter, gone, without nibbling at the one beside it. A hole rubbed through
   *  what is under the nib is what you want over a drawing, where half a line is
   *  worth keeping. So both, as two named things, with the circle in the middle
   *  showing exactly how wide the nib is about to be.
   *
   *  What it deliberately does not offer is a switch that spares one kind of ink,
   *  the way Samsung's "erase highlighter only" does: leave it on by accident and
   *  the eraser stops working on your handwriting with nothing on screen to say
   *  why. An eraser rubs out what it is over. */

  import CanvasDial from './CanvasDial.svelte'
  import { LEAST_RUB, MOST_RUB, pens } from './canvas/pens.svelte'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const { onerase }: { onerase: () => void } = $props()

  const WAYS = [
    { whole: true, word: () => t('Stroke'), title: () => t('A whole stroke at a touch') },
    { whole: false, word: () => t('Area'), title: () => t('Only what is under the nib') },
  ] as const

  function way(whole: boolean) {
    tick()
    pens.rubbing({ whole })
  }
</script>

<div class="rub">
  <div class="nib-segmented">
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

  <!-- How wide, shown as the width. The circle is the nib at its real size, so
       there is nothing to read off a number and imagine. -->
  <div class="wide" class:off={pens.whole}>
    <span class="ring" style:width="{pens.rub * 2}px" style:height="{pens.rub * 2}px"></span>

    <CanvasDial
      value={pens.rub}
      least={LEAST_RUB}
      most={MOST_RUB}
      step={2}
      label={t('Width')}
      reading={String(pens.rub)}
      onvalue={(rub: number) => pens.rubbing({ rub })}
    />
  </div>

  <button
    type="button"
    class="all"
    title={t('Erase everything drawn')}
    aria-label={t('Erase everything drawn')}
    onclick={() => {
      tick()
      onerase()
    }}
  >
    {t('Everything')}
  </button>
</div>

<style>
  .rub {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The nib at its real width, on the paper, beside the dial that sets it. */
  .wide {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* A whole stroke goes whatever the nib is, so the dial has nothing to say. */
  .wide.off {
    opacity: 0.35;
    pointer-events: none;
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

  /* Every stroke gone is the one destructive thing in here. */
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

  .all:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  :global([data-touch]) .all {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
