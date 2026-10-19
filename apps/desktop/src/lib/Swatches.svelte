<script lang="ts">
  /** A row of colours as dots, the way GNOME and a Mac offer an accent: in Settings
   *  wherever a theme offers a colour, and at the foot of the theme picker. One row
   *  everywhere, so the dots are the same size, the same ring and the same order
   *  wherever a colour is chosen.
   *
   *  Each dot is drawn in the shade the scheme on screen needs, which the caller has
   *  already picked. `onpoint` is the picker's: a dot under the pointer is tried on
   *  the whole app, and null gives the kept one back.
   *
   *  `pair` is glass's: two dots after the swatches, each the platform's colour picker,
   *  for two colours of the reader's own - a wheel until they are, then the two colours
   *  wearing the ring. Tried while the picker is open, kept when it closes. */
  import { t } from './i18n.svelte'
  import type { PairField, SwatchOption } from './preferences'

  const {
    options,
    label,
    chosen,
    onchoose,
    onpoint,
    pair,
  }: {
    options: SwatchOption[]
    label: string
    chosen: string
    onchoose: (value: string) => void
    onpoint?: ((value: string | null) => void) | undefined
    pair?: PairField | undefined
  } = $props()

  /** One of the two picked: the other stays what the row shows now. */
  function pick(which: number, colour: string, kept: boolean) {
    if (!pair) return
    const [first, second] = pair.get()
    const next: [string, string] = which === 0 ? [colour, second] : [first, colour]
    if (kept) pair.set(...next)
    else pair.preview(...next)
  }
</script>

<div class="swatches" role="group" aria-label={label} onpointerleave={() => onpoint?.(null)}>
  {#each options as one (one.value)}
    <button
      type="button"
      class="swatch"
      class:active={chosen === one.value}
      title={one.label}
      aria-label={one.label}
      aria-pressed={chosen === one.value}
      style:--swatch={one.colour}
      onpointermove={() => onpoint?.(one.value)}
      onclick={() => onchoose(one.value)}
    ></button>
  {/each}

  {#if pair}
    {@const own = pair.own()}
    {#each pair.get() as colour, which (which)}
      <label
        class="swatch picked"
        class:active={own}
        class:wheel={!own}
        title={t('Another colour')}
        style:--swatch={own ? colour : undefined}
      >
        <input
          type="color"
          value={colour}
          aria-label={t('Another colour')}
          oninput={(event) => pick(which, event.currentTarget.value, false)}
          onchange={(event) => pick(which, event.currentTarget.value, true)}
        />
      </label>
    {/each}
  {/if}
</div>

<style>
  .swatches {
    --swatch-edge: color-mix(in srgb, var(--text) 12%, transparent);
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .swatch {
    position: relative;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    /* A hairline of the ink, so a pale colour - glass's pastel pairs on the light side -
       keeps its edge on the surface it is drawn on. */
    box-shadow: inset 0 0 0 1px var(--swatch-edge);
    cursor: default;
    /* Only the swatch under the pointer moves, and it moves plainly. The ring
       marking the chosen one is a state rather than a movement, so it is left
       out of the transition: it should appear, not grow. */
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  /* A ring rather than a tick: the colour is the whole point of the control. Drawn
     behind the dot in the dot's own paint, so a swatch that is a blend wears a ring of
     its blend. */
  .swatch.active {
    background: none;
  }

  .swatch.active::before,
  .swatch.active::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    background: var(--swatch);
  }

  .swatch.active::before {
    inset: -4px;
  }

  .swatch.active::after {
    inset: 0;
    box-shadow:
      inset 0 0 0 1px var(--swatch-edge),
      0 0 0 2px var(--surface);
  }

  /* Two colours of one's own: a wheel of soft colours until there are, so the dot says
     what pressing it does without a word. */
  .picked {
    overflow: visible;
    cursor: pointer;
  }

  .wheel {
    --swatch: conic-gradient(#bfddfb, #c4ece0, #efe3c6, #fbdcc4, #f1c4d6, #ddd0f7, #bfddfb);
  }

  .picked input {
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

  /* A thumb's worth each, on a touch screen. */
  :global([data-touch]) .swatches {
    gap: 12px;
  }

  :global([data-touch]) .swatch {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
