<script lang="ts">
  /** The canvas's own bar: what your hand is holding, and what colour it is.
   *
   *  One row of glyphs. A shape, not a word, says what each one does, and the one
   *  that is pressed in is the one in your hand. The pen's own row appears above
   *  it only while a pen is in your hand, so a plane nobody is drawing on shows
   *  eleven buttons rather than twenty-two.
   *
   *  The dots mean "this colour" and apply to whatever the moment is about: what
   *  is picked, or the pen, or the next shape. One row of colours rather than
   *  three, because there is only ever one answer to "which colour".
   *
   *  It stops every pointer at itself. The plane behind it treats a press as a
   *  gesture, and a bar that let one through would clear the selection its own
   *  buttons are for; that is the whole of the bug this replaced. */

  import { PENS, tools } from './canvas/tools.svelte'
  import { type InkTool } from './canvas/format'
  import { DOTS } from './canvas/palette'
  import { type Tool } from './canvas/pointer'
  import { t } from './i18n.svelte'
  import { viewport } from './viewport.svelte'

  const {
    oncolour,
    onsize,
    colour,
    size,
    colouring,
  }: {
    oncolour: (colour: string | null) => void
    onsize: (size: number) => void
    /** The colour in hand, so the dot that is on shows it. */
    colour: string | null
    size: number
    /** Whether anything is picked, which is what the dots would colour. */
    colouring: boolean
  } = $props()

  interface Glyph {
    id: Tool
    title: string
    path: string
  }

  /** What a press on the plane means. The arrow, the hand, and the three a pen
   *  wants. */
  const HOLDING: Glyph[] = [
    { id: 'select', title: t('Select'), path: 'M3.4 2.2 11 6.4l-3.3.9L9 11l-1.5.6-1.3-3.7-2.4 2.2z' },
    {
      id: 'hand',
      title: t('Pan'),
      path: 'M4 7.5V4.4a.9.9 0 0 1 1.8 0V7m0 0V3.4a.9.9 0 0 1 1.8 0V7m0 0V4.2a.9.9 0 0 1 1.8 0v4.4A3.4 3.4 0 0 1 6 12a3 3 0 0 1-2-2.8z',
    },
    { id: 'draw', title: t('Draw'), path: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5zM8.3 3.8l1.9 1.9' },
    {
      id: 'erase',
      title: t('Erase'),
      path: 'M4 11.4h7.4M2.8 8.6l4.3-4.3a1.3 1.3 0 0 1 1.9 0l1.7 1.7a1.3 1.3 0 0 1 0 1.9l-3.4 3.5H5.2z',
    },
    {
      id: 'lasso',
      title: t('Lasso'),
      path: 'M7 2.6c2.7 0 4.9 1.6 4.9 3.5S9.7 9.6 7 9.6 2.1 8 2.1 6.1 4.3 2.6 7 2.6M5.6 9.5c0 1.3.4 2 1.3 2',
    },
  ]

  /** What a press puts on the plane. */
  const PLACING: Glyph[] = [
    { id: 'text', title: t('Card'), path: 'M2 3h10v8H2zM4.5 6h5M4.5 8h3' },
    { id: 'file', title: t('Note or picture'), path: 'M3.5 2h4l3 3v7h-7zM7.5 2v3h3' },
    {
      id: 'link',
      title: t('Link'),
      path: 'M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6',
    },
    { id: 'group', title: t('Group'), path: 'M2 4h10v8H2zM2 4V2h4v2' },
    { id: 'rect', title: t('Rectangle'), path: 'M2.5 3.5h9v7h-9z' },
    { id: 'ellipse', title: t('Ellipse'), path: 'M11.5 7a4.5 3.6 0 1 1-9 0 4.5 3.6 0 1 1 9 0' },
    { id: 'line', title: t('Line'), path: 'M2.6 11.4 11.4 2.6' },
    { id: 'arrow', title: t('Arrow'), path: 'M2.6 11.4 11.4 2.6M11.4 2.6H7.8M11.4 2.6v3.6' },
  ]

  /** A glyph each for the seven pens: a nib, a broad nib, a grainy one, a felt
   *  tip, a wide flat one, a brush and a chisel. */
  const NIBS: Record<InkTool, string> = {
    pen: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5z',
    fountain: 'M3 11.4 4.6 7 9.4 2.2l2.4 2.4L7 9.4zM4.6 7l2.4 2.4',
    pencil: 'M2.6 11.4 3.5 8.6 9 3.1l1.9 1.9-5.5 5.5zM4.6 8.2l1.2 1.2M6.2 6.6l1.2 1.2M7.8 5l1.2 1.2',
    marker: 'M3.4 11.4h7.2M4.4 8.8 8.2 5l2.2 2.2-3.8 3.8H4.4z',
    highlighter: 'M2.6 11.4h8.8M3.8 8.6 8.6 3.8l2.4 2.4-4.8 4.8H3.8z',
    brush: 'M3.6 10.6c1.8.8 3.4 0 3.8-1.8M5.2 8.4 10 3.6l1.2 1.2-4.8 4.8z',
    calligraphy: 'M2.6 10.6 9.8 3M4.2 11.8 11.4 4.2',
  }

  const SIZES = [1.5, 3, 6, 12]

  /** How big a glyph reads. A finger and a pen want a bigger target than a
   *  mouse, and a tablet is held further away. */
  const wide = $derived(viewport.phone)
</script>

<!-- Every pointer stops here. See the note at the top of the file. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cluster"
  class:wide
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
>
  {#if tools.which === 'draw'}
    <div class="nib-bar bar pens">
      {#each PENS as pen (pen)}
        <button
          type="button"
          class:on={tools.pen === pen}
          title={t(pen)}
          aria-label={t(pen)}
          aria-pressed={tools.pen === pen}
          onclick={() => tools.choosePen(pen)}
        >
          <svg viewBox="0 0 14 14" style:stroke-width={pen === 'highlighter' ? 1 : 1.2}>
            <path d={NIBS[pen]} />
          </svg>
        </button>
      {/each}

      <span class="split"></span>

      {#each SIZES as one (one)}
        <button
          type="button"
          class="nib"
          class:on={size === one}
          title={t('Width {number}', { number: one })}
          aria-label={t('Width {number}', { number: one })}
          aria-pressed={size === one}
          onclick={() => onsize(one)}
        >
          <span style:width="{2 + one}px" style:height="{2 + one}px"></span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="nib-bar bar">
    <div class="scroller">
      {#each HOLDING as one (one.id)}
        <button
          type="button"
          class:on={tools.which === one.id}
          class:pinned={tools.which === one.id && tools.sticky}
          title={one.title}
          aria-label={one.title}
          aria-pressed={tools.which === one.id}
          onclick={() => tools.choose(one.id)}
        >
          <svg viewBox="0 0 14 14"><path d={one.path} /></svg>
        </button>
      {/each}

      <span class="split"></span>

      {#each PLACING as one (one.id)}
        <button
          type="button"
          class:on={tools.which === one.id}
          title={one.title}
          aria-label={one.title}
          aria-pressed={tools.which === one.id}
          onclick={() => tools.choose(one.id)}
        >
          <svg viewBox="0 0 14 14"><path d={one.path} /></svg>
        </button>
      {/each}

      <span class="split"></span>

      {#each DOTS as dot (dot.colour)}
        <button
          type="button"
          class="dot"
          class:on={colour === dot.colour}
          title={t('Colour {number}', { number: dot.colour })}
          aria-label={t('Colour {number}', { number: dot.colour })}
          aria-pressed={colour === dot.colour}
          style:--dot={dot.css}
          onclick={() => oncolour(dot.colour)}
        ></button>
      {/each}

      <button
        type="button"
        class="dot none"
        class:on={colour === null}
        title={t('No colour')}
        aria-label={t('No colour')}
        aria-pressed={colour === null}
        disabled={!colouring && tools.which !== 'draw'}
        onclick={() => oncolour(null)}
      ></button>

      <!-- A colour of your own. The input is the dot, so there is nothing extra
           to learn and nothing extra to draw. -->
      <label class="dot custom" title={t('Another colour')}>
        <input
          type="color"
          value={colour && colour.startsWith('#') ? colour : '#7c5cff'}
          aria-label={t('Another colour')}
          oninput={(event) => oncolour(event.currentTarget.value)}
        />
      </label>
    </div>
  </div>
</div>

<style>
  /* Over the plane, at the bottom of the pane and clear of its corners, with
     room for a phone's home bar underneath. */
  .cluster {
    position: absolute;
    left: 50%;
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    translate: -50% 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-3));
    animation: rise var(--dur-base) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 8px;
    }
  }

  .bar {
    align-items: center;
    max-width: 100%;
  }

  /* The pen's own row arrives from under the bar it belongs to. */
  .pens {
    animation: lift var(--dur-fast) var(--ease-out);
  }

  @keyframes lift {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }

  /* A phone cannot show twenty glyphs at once, so the row scrolls rather than
     hiding half of them behind a menu. */
  .scroller {
    display: flex;
    align-items: center;
    gap: 1px;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .scroller::-webkit-scrollbar {
    display: none;
  }

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .wide svg {
    width: 17px;
    height: 17px;
  }

  .wide button {
    min-width: 34px;
    height: 34px;
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* A tool that stays in your hand until you put it down wears a bar under it. */
  button.pinned {
    box-shadow: inset 0 -2px 0 -0.5px var(--accent);
  }

  .split {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    flex: none;
    background: var(--line-strong);
  }

  /* A colour is a colour: the dot is the whole button, and hovering lifts it
     rather than painting the accent over it. */
  .dot {
    min-width: 0;
    width: 16px;
    height: 16px;
    margin: 0 1px;
    padding: 0;
    flex: none;
    border-radius: 50%;
    background: var(--dot);
    transition:
      scale var(--dur-fast) var(--ease-spring),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .wide .dot {
    width: 20px;
    height: 20px;
  }

  .dot:hover:not(:disabled) {
    background: var(--dot);
    scale: 1.18;
  }

  .dot:active:not(:disabled) {
    background: var(--dot);
    scale: 1.05;
  }

  .dot.on {
    background: var(--dot);
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent);
  }

  .dot:disabled {
    opacity: 0.3;
  }

  /* No colour at all, drawn as the ring the others fill. */
  .dot.none {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--muted);
  }

  .dot.none:hover:not(:disabled),
  .dot.none:active:not(:disabled) {
    background: none;
  }

  .dot.none.on {
    background: none;
    box-shadow:
      inset 0 0 0 1.5px var(--muted),
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--accent);
  }

  /* Every colour there is, behind a dot that shows the wheel. */
  .dot.custom {
    display: block;
    overflow: hidden;
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
    cursor: pointer;
  }

  .dot.custom input {
    width: 200%;
    height: 200%;
    margin: -50%;
    padding: 0;
    border: none;
    background: none;
    opacity: 0;
    cursor: pointer;
  }

  /* The dot the pen is currently writing in. */
  .nib {
    min-width: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    flex: none;
    display: grid;
    place-items: center;
  }

  .nib span {
    display: block;
    border-radius: 50%;
    background: currentColor;
  }
</style>
