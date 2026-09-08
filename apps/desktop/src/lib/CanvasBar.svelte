<script lang="ts">
  /** The canvas's own bar for a pointer: what your hand is holding, and what
   *  colour it is.
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
   *  A finger gets `CanvasPens.svelte` instead: a mouse can hit a fourteen-pixel
   *  glyph and read a row of twenty-two, and a thumb can do neither.
   *
   *  It stops every pointer at itself. The plane behind it treats a press as a
   *  gesture, and a bar that let one through would clear the selection its own
   *  buttons are for; that is the whole of the bug this replaced. */

  import { INK_SIZES, PENS, tools } from './canvas/tools.svelte'
  import { FINGER, HOLDING, NIBS, PEN_NAMES, PLACING } from './canvas/glyphs'
  import { hand } from './canvas/hand.svelte'
  import { DOTS } from './canvas/palette'
  import { pens } from './canvas/pens.svelte'
  import { t } from './i18n.svelte'

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
</script>

<!-- Every pointer stops here. See the note at the top of the file. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cluster"
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
>
  {#if tools.which === 'draw'}
    <div class="nib-bar bar pens">
      <div class="scroller">
        {#each PENS as pen (pen)}
          <button
            type="button"
            class:on={pens.current.tool === pen}
            title={PEN_NAMES[pen]}
            aria-label={PEN_NAMES[pen]}
            aria-pressed={pens.current.tool === pen}
            onclick={() => tools.choosePen(pen)}
          >
            <svg viewBox="0 0 14 14" style:stroke-width={pen === 'highlighter' ? 1 : 1.2}>
              <path d={NIBS[pen]} />
            </svg>
          </button>
        {/each}

        <span class="split"></span>

        {#each INK_SIZES as one (one)}
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

        <!-- Only where there is a pen to be the other instrument. On a phone the
             finger is the only one there is, so there is nothing to ask. -->
        {#if hand.penSeen}
          <span class="split"></span>

          <button
            type="button"
            class:on={hand.fingerDraws}
            title={t('Finger draws')}
            aria-label={t('Finger draws')}
            aria-pressed={hand.fingerDraws}
            onclick={() => hand.toggleFinger()}
          >
            <svg viewBox="0 0 14 14"><path d={FINGER} /></svg>
          </button>
        {/if}
      </div>
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
          value={colour?.startsWith('#') ? colour : '#7c5cff'}
          aria-label={t('Another colour')}
          oninput={(event) => oncolour(event.currentTarget.value)}
        />
      </label>
    </div>
  </div>
</div>

<style>
  /* Over the plane, at the bottom of the pane and clear of its corners. */
  .cluster {
    position: absolute;
    left: 50%;
    bottom: calc(var(--space-4) + var(--inset-bottom));
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

  /* A narrow window cannot show twenty glyphs at once, so the row scrolls rather
     than hiding half of them behind a menu. */
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
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--accent);
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
