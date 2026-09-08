<script lang="ts">
  /** Which colour, asked as a row of colours.
   *
   *  The six the theme names, the ones used lately, and every other colour there
   *  is behind the wheel. Recent ones matter on a plane: a drawing is two or three
   *  colours used over and over, and a hand that mixed a particular green wants
   *  that green again on the next stroke rather than a second trip round the
   *  picker.
   *
   *  It says nothing about what it is colouring. The pen's popover shows it for
   *  the pen and the bar shows it for what is picked; both hand back a colour and
   *  the surface decides what that means, so there is one row of colours in the
   *  app and one answer to "which colour". */

  import { DOTS } from './canvas/palette'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const {
    colour,
    recent = [],
    none = true,
    oncolour,
  }: {
    /** The colour in hand, so the dot that is on shows it. */
    colour: string | null
    /** Colours used lately, newest first. */
    recent?: readonly string[]
    /** Whether "no colour at all" is one of the answers. */
    none?: boolean
    oncolour: (colour: string | null) => void
  } = $props()

  function choose(next: string | null) {
    tick()
    oncolour(next)
  }
</script>

<div class="colours">
  {#each DOTS as dot (dot.colour)}
    <button
      type="button"
      class="dot"
      class:on={colour === dot.colour}
      title={t('Colour {number}', { number: dot.colour })}
      aria-label={t('Colour {number}', { number: dot.colour })}
      aria-pressed={colour === dot.colour}
      style:--dot={dot.css}
      onclick={() => choose(dot.colour)}
    ></button>
  {/each}

  {#if none}
    <button
      type="button"
      class="dot bare"
      class:on={colour === null}
      title={t('No colour')}
      aria-label={t('No colour')}
      aria-pressed={colour === null}
      onclick={() => choose(null)}
    ></button>
  {/if}

  <!-- A colour of your own. The input is the dot, so there is nothing extra to
       learn and nothing extra to draw. -->
  <label class="dot wheel" title={t('Another colour')}>
    <input
      type="color"
      value={colour?.startsWith('#') ? colour : '#7c5cff'}
      aria-label={t('Another colour')}
      oninput={(event) => choose(event.currentTarget.value)}
    />
  </label>

  {#each recent as one (one)}
    <button
      type="button"
      class="dot"
      class:on={colour === one}
      title={t('The colour you used before')}
      aria-label={t('The colour you used before')}
      aria-pressed={colour === one}
      style:--dot={one}
      onclick={() => choose(one)}
    ></button>
  {/each}
</div>

<style>
  /* One row that wraps, so six presets and six remembered colours read as one
     field of colour rather than as two lists. */
  .colours {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  /* The dot is the whole button, with a finger's worth of room round it. */
  .dot {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    cursor: default;
  }

  .dot::after {
    content: '';
    display: block;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
    transition:
      scale var(--dur-fast) var(--ease-spring),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .dot:hover::after {
    scale: 1.12;
  }

  .dot:active::after {
    scale: 1.04;
  }

  .dot.on::after {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.1),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  /* No colour at all, drawn as the ring the others fill. */
  .bare::after {
    background: none;
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  .bare.on::after {
    box-shadow:
      inset 0 0 0 2px var(--muted),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  /* Every colour there is, behind a dot that shows the wheel. */
  .wheel {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .wheel::after {
    background: conic-gradient(
      from 0deg,
      #e5484d,
      #f76b15,
      #f5d90a,
      #46a758,
      #05a2c2,
      #8e4ec6,
      #e5484d
    );
  }

  .wheel input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    opacity: 0;
    cursor: pointer;
  }
</style>
