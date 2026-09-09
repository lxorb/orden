<script lang="ts">
  /** How the pen in your hand is set: what it writes with, how wide, how much of
   *  the colour lands, and in which colour.
   *
   *  It opens by pressing the pen you are already holding, which is the one
   *  gesture nobody has to be told: the pen is out, press it again and it opens up.
   *  Every dial changes that one of the three slots rather than some width the
   *  whole app shares, so the fine green biro stays a fine green biro after an
   *  afternoon with the highlighter.
   *
   *  The line across the top is the app's own ink, not a picture of it. The same
   *  outliner that paints the plane draws it, from a stroke pressed the way a hand
   *  presses, so a fountain pen swells in the middle, a brush tapers to nothing and
   *  a chisel nib goes thin on the turn: what the box shows is what the nib will
   *  do, while the slider is still moving. */

  import CanvasColours from './CanvasColours.svelte'
  import CanvasDial from './CanvasDial.svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import { MARKS, PEN_ICONS, PEN_NAMES } from './canvas/glyphs'
  import { INK_TOOLS, type InkTool } from './canvas/format'
  import { hand } from './canvas/hand.svelte'
  import { INK_STYLES } from './canvas/ink'
  import { samplePath } from './canvas/nibs'
  import { DEFAULT_INK, shownInk } from './canvas/palette'
  import { LEAST_WIDTH, MOST_WIDTH, type Nib, nibFor, pens } from './canvas/pens.svelte'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const { nib }: { nib: Nib } = $props()

  /** How wide the sample line is drawn, in plane units, which is also how wide the
   *  box is on screen: a pen three units across then looks three units across, and
   *  the fattest one fills the box the way it fills a word. */
  const WIDE = 288
  const TALL = 62

  const line = $derived(samplePath(nib, WIDE, TALL))
  const ink = $derived(shownInk(nib.colour))
  const multiply = $derived(INK_STYLES[nib.tool].multiply)

  /** The colour the row shows as on, which is nothing for the theme's own ink: the
   *  bare dot means "whatever the page is written in", and that is what a pen with
   *  no colour of its own writes. */
  const shown = $derived(nib.colour === 'ink' ? null : nib.colour)

  function setTool(tool: InkTool) {
    tick()
    pens.set(nibFor(tool, nib.colour))
  }

  /** A colour chosen in here is the pen's, always: this panel is about one pen
   *  and nothing else on the plane. */
  function setColour(colour: string | null) {
    tick()
    pens.set({ colour: colour ?? DEFAULT_INK })
  }
</script>

<div class="pen">
  <!-- What the pen will do, drawn with the pen. -->
  <div class="sample" style:--ink={ink}>
    <svg viewBox="0 0 {WIDE} {TALL}" aria-hidden="true">
      <path
        d={line}
        fill="var(--ink)"
        fill-opacity={nib.opacity}
        style:mix-blend-mode={multiply ? 'multiply' : undefined}
      />
    </svg>
  </div>

  <!-- Which nib this pen has. The word beside the mark, because a drawing of a
       nib and a drawing of a broad nib are two pictures of one thing. -->
  <div class="kinds">
    {#each INK_TOOLS as tool (tool)}
      <button
        type="button"
        class:on={nib.tool === tool}
        title={PEN_NAMES[tool]()}
        aria-label={PEN_NAMES[tool]()}
        aria-pressed={nib.tool === tool}
        onclick={() => setTool(tool)}
      >
        <CanvasIcon node={PEN_ICONS[tool]} />
        <span>{PEN_NAMES[tool]()}</span>
      </button>
    {/each}
  </div>

  <CanvasDial
    value={nib.size}
    least={LEAST_WIDTH}
    most={MOST_WIDTH}
    step={0.5}
    label={t('Width')}
    reading={String(nib.size)}
    onvalue={(size: number) => pens.set({ size })}
  />

  <CanvasDial
    value={nib.opacity}
    least={0.05}
    most={1}
    step={0.05}
    label={t('Opacity')}
    reading="{Math.round(nib.opacity * 100)}%"
    onvalue={(opacity: number) => pens.set({ opacity })}
  />

  <!-- The bare dot is the ink the page itself is written in, drawn in that ink rather
       than as a hole: a hole shows the panel through it, which read as a white dot in
       a light theme and a dark one in a dark theme, for the same pen. -->
  <CanvasColours
    colour={shown}
    recent={pens.recent}
    bare={{ css: 'var(--text-strong)', title: t('The ink of the page') }}
    oncolour={setColour}
  />

  <div class="rest">
    <!-- A stroke held still becomes the line, ring or box it was aiming at. On,
         because a hand drawing a box wants a box; off for anybody sketching. -->
    <button
      type="button"
      class:on={pens.straighten}
      title={t('Straighten')}
      aria-label={t('Straighten')}
      aria-pressed={pens.straighten}
      onclick={() => {
        tick()
        pens.straightening(!pens.straighten)
      }}
    >
      <CanvasIcon node={MARKS.straight} />
      <span>{t('Straighten')}</span>
    </button>

    <!-- Only where there is a pen to be the other instrument. On a phone the
         finger is the only one there is, so there is nothing to ask. -->
    {#if hand.penSeen}
      <button
        type="button"
        class:on={hand.fingerDraws}
        title={t('Finger draws')}
        aria-label={t('Finger draws')}
        aria-pressed={hand.fingerDraws}
        onclick={() => {
          tick()
          hand.toggleFinger()
        }}
      >
        <CanvasIcon node={MARKS.finger} />
        <span>{t('Finger draws')}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .pen {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The line, on the page it would be written on rather than on the panel: a
     translucent pen has to be seen over paper to be judged. */
  .sample {
    height: 62px;
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--line);
    overflow: hidden;
  }

  .sample svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* The seven, in two columns of words. A row of seven marks with no words is
     seven puzzles; a list of seven lines is read once and never again. */
  .kinds {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
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
    text-align: left;
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

  button:active:not(:disabled) {
    background: var(--press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* The switches under the dials, side by side and the same size. */
  .rest {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 1px;
  }

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
