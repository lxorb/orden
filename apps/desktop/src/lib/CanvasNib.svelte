<script lang="ts">
  /** How the pen in your hand is set: what it writes, how wide, how much of the
   *  colour lands, and in which colour.
   *
   *  It opens by pressing the pen you are already holding, which is the one
   *  gesture nobody has to be told: the pen is out, press it again and it opens
   *  up. Every dial changes the pen in the row rather than some width the whole
   *  app shares, so the fine green biro stays a fine green biro after an
   *  afternoon with the highlighter.
   *
   *  The line across the top is the app's own ink, not a picture of it. The same
   *  outliner that paints the plane draws it, from a stroke pressed the way a
   *  hand presses, so a fountain pen swells in the middle, a brush tapers to
   *  nothing and a chisel nib goes thin on the turn: what the box shows is what
   *  the nib will do, while the slider is still moving. */

  import { INK_STYLES } from './canvas/ink'
  import { FINGER, MARKS, NIBS, PEN_NAMES } from './canvas/glyphs'
  import { hand } from './canvas/hand.svelte'
  import { PEN_ART, PEN_BOX, samplePath } from './canvas/nibs'
  import { LEAST_WIDTH, MOST_WIDTH, type Nib, nibFor, MOST_PENS, pens } from './canvas/pens.svelte'
  import { INK_TOOLS, type InkTool } from './canvas/format'
  import { shownColour } from './canvas/palette'
  import { tick } from './canvas/tick'
  import CanvasColours from './CanvasColours.svelte'
  import { t } from './i18n.svelte'

  const {
    nib,
    oncolour,
    onremove,
  }: {
    /** The pen being set, which is always the one that is out. */
    nib: Nib
    oncolour: (colour: string | null) => void
    /** This pen out of the row, or nothing when it is the only one left. */
    onremove: (() => void) | null
  } = $props()

  /** How wide the sample line is drawn, in plane units, which is also how wide
   *  the box is on screen: a pen three units across then looks three units
   *  across, and the fattest one fills the box the way it fills a word. */
  const WIDE = 288
  const TALL = 62

  const line = $derived(samplePath(nib, WIDE, TALL))
  const ink = $derived(shownColour(nib.colour) ?? 'var(--text-strong)')
  const multiply = $derived(INK_STYLES[nib.tool].multiply)

  /** The colour the row shows as on, which is `null` for the theme's own ink: the
   *  bare dot means "whatever the page is written in", and that is what a pen
   *  with no colour of its own writes. */
  const shown = $derived(nib.colour === 'ink' ? null : nib.colour)

  function setTool(tool: InkTool) {
    tick()
    pens.set(nibFor(tool, nib.colour))
  }
</script>

<div class="nib">
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

  <!-- Which nib this pen has. Pressing one turns the pen in your hand into that
       kind of pen, as it comes, in the colour it was already writing in. -->
  <div class="kinds">
    {#each INK_TOOLS as tool (tool)}
      <button
        type="button"
        class:on={nib.tool === tool}
        title={PEN_NAMES[tool]}
        aria-label={PEN_NAMES[tool]}
        aria-pressed={nib.tool === tool}
        onclick={() => setTool(tool)}
      >
        <svg class="glyph" viewBox="0 0 14 14"><path d={NIBS[tool]} /></svg>
      </button>
    {/each}
  </div>

  <label class="dial">
    <span class="reading">{nib.size}</span>
    <input
      class="nib-slider"
      type="range"
      min={LEAST_WIDTH}
      max={MOST_WIDTH}
      step="0.5"
      value={nib.size}
      aria-label={t('Width')}
      style:--fill="{((nib.size - LEAST_WIDTH) / (MOST_WIDTH - LEAST_WIDTH)) * 100}%"
      oninput={(event) => pens.set({ size: Number(event.currentTarget.value) })}
    />
  </label>

  <label class="dial">
    <span class="reading">{Math.round(nib.opacity * 100)}%</span>
    <input
      class="nib-slider"
      type="range"
      min="0.05"
      max="1"
      step="0.01"
      value={nib.opacity}
      aria-label={t('Opacity')}
      style:--fill="{((nib.opacity - 0.05) / 0.95) * 100}%"
      oninput={(event) => pens.set({ opacity: Number(event.currentTarget.value) })}
    />
  </label>

  <CanvasColours colour={shown} recent={pens.recent} none={false} {oncolour} />

  <div class="rest">
    <!-- Another of this pen, to set some other way. Only where there is room for
         one: a row of favourites that runs past the screen is not a set. -->
    <button
      type="button"
      title={t('Keep this pen')}
      aria-label={t('Keep this pen')}
      disabled={pens.list.length >= MOST_PENS}
      onclick={() => {
        tick()
        pens.add(nib.tool)
      }}
    >
      <svg class="pen" viewBox="0 0 {PEN_BOX.width} {PEN_BOX.height}" aria-hidden="true">
        <path class="barrel" d={PEN_ART[nib.tool].barrel} />
        <path class="detail" d={PEN_ART[nib.tool].detail} />
        <path
          class="tip"
          d={PEN_ART[nib.tool].nib}
          fill-rule="evenodd"
          style:fill={ink}
          style:fill-opacity={nib.opacity}
        />
      </svg>
      <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.plus} /></svg>
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
        <svg class="glyph" viewBox="0 0 14 14"><path d={FINGER} /></svg>
      </button>
    {/if}

    {#if onremove}
      <button
        type="button"
        class="gone"
        title={t('Put this pen away')}
        aria-label={t('Put this pen away')}
        onclick={() => {
          tick()
          onremove()
        }}
      >
        <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.less} /></svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .nib {
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

  .kinds {
    display: flex;
    gap: 1px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .kinds::-webkit-scrollbar {
    display: none;
  }

  button {
    flex: none;
    display: grid;
    place-items: center;
    min-width: var(--touch-target);
    height: var(--touch-target);
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:active:not(:disabled) {
    background: var(--surface-3);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  button:disabled {
    opacity: 0.35;
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

  /* A dial and what it reads, on one line, the number first so the row of them
     lines up down the left however wide the panel is. */
  .dial {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .reading {
    flex: none;
    width: 3.2rem;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .dial input {
    flex: 1;
    min-width: 0;
  }

  .rest {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  /* The button that keeps this pen shows the pen it would keep, with the plus
     tucked against it. */
  .rest .pen {
    width: 15px;
    height: 30px;
  }

  .rest .pen + .glyph {
    width: 13px;
    height: 13px;
    margin-left: -2px;
  }

  .rest button:first-child {
    min-width: calc(var(--touch-target) + 8px);
    grid-auto-flow: column;
    place-items: center;
  }

  .barrel {
    fill: var(--line-strong);
  }

  .detail {
    fill: var(--muted);
  }

  .tip {
    stroke: var(--line-strong);
    stroke-width: 0.6;
  }

  /* Taking a pen out of the row is the one destructive thing in here. */
  .gone {
    margin-left: auto;
    color: var(--danger);
  }

  .gone:active {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
</style>
