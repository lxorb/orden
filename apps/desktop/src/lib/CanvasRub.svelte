<script lang="ts">
  /** How the eraser is set: what it takes, and how much of it.
   *
   *  Two ways of rubbing out, and they are different tools rather than degrees of
   *  one. A whole stroke goes at a touch, which is what you want over handwriting:
   *  one letter, gone, without nibbling at the one beside it. A hole rubbed
   *  through what is under the nib is what you want over a drawing, where half a
   *  line is worth keeping. So both, said as a shape and a word, with the circle
   *  in the middle showing exactly how wide the nib is about to be.
   *
   *  What it deliberately does not offer is a switch that spares one kind of ink,
   *  the way Samsung's "erase highlighter only" does: leave it on by accident and
   *  the eraser stops working on your handwriting with nothing on screen to say
   *  why. An eraser rubs out what it is over. */

  import { MARKS } from './canvas/glyphs'
  import { LEAST_RUB, MOST_RUB, pens } from './canvas/pens.svelte'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const { onerase }: { onerase: () => void } = $props()

  const WAYS = [
    { whole: true, path: MARKS.whole, word: t('Stroke'), title: t('A whole stroke at a touch') },
    { whole: false, path: MARKS.area, word: t('Area'), title: t('Only what is under the nib') },
  ] as const

  function way(whole: boolean) {
    tick()
    pens.rubbing({ whole })
  }
</script>

<div class="rub">
  <div class="ways">
    {#each WAYS as one (one.whole)}
      <button
        type="button"
        class:on={pens.whole === one.whole}
        title={one.title}
        aria-label={one.title}
        aria-pressed={pens.whole === one.whole}
        onclick={() => way(one.whole)}
      >
        <svg class="glyph" viewBox="0 0 14 14"><path d={one.path} /></svg>
        <span>{one.word}</span>
      </button>
    {/each}
  </div>

  <!-- How wide, shown as the width. The circle is the nib at its real size, so
       there is nothing to read off a number and imagine. -->
  <div class="wide" class:off={pens.whole}>
    <span class="ring" style:width="{pens.rub * 2}px" style:height="{pens.rub * 2}px"></span>
    <input
      class="nib-slider"
      type="range"
      min={LEAST_RUB}
      max={MOST_RUB}
      step="1"
      value={pens.rub}
      disabled={pens.whole}
      aria-label={t('Width')}
      style:--fill="{((pens.rub - LEAST_RUB) / (MOST_RUB - LEAST_RUB)) * 100}%"
      oninput={(event) => pens.rubbing({ rub: Number(event.currentTarget.value) })}
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
    <span>{t('Everything')}</span>
  </button>
</div>

<style>
  .rub {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The two ways, side by side and the same size, because neither is the lesser
     one. */
  .ways {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }

  button {
    display: grid;
    place-items: center;
    gap: 2px;
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:active {
    background: var(--surface-3);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .glyph {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The nib at its real width, on the paper, beside the dial that sets it. */
  .wide {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-2);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* A whole stroke goes whatever the nib is, so the dial has nothing to say. */
  .wide.off {
    opacity: 0.35;
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

  .wide input {
    flex: 1;
    min-width: 0;
  }

  .all {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .all:active {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
  }
</style>
