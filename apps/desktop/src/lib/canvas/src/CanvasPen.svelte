<script lang="ts">
  import { CanvasColours, Glyph, tick } from '../../ui-controls/src/api'
  import CanvasDial from './CanvasDial.svelte'
  import { MARKS, PEN_ICONS, PEN_NAMES } from './glyphs'
  import { INK_TOOLS, type InkTool } from '@orden/markdown/canvas'
  import { hand } from './hand.svelte'
  import { INK_STYLES } from '../../plane/src/api'
  import { samplePath } from './nibs'
  import { DEFAULT_INK, shownInk } from '../../plane/src/api'
  import { LEAST_WIDTH, MOST_WIDTH, type Nib, nibFor, pens } from './pens.svelte'

  const { nib }: { nib: Nib } = $props()

  const WIDE = 288
  const TALL = 62

  const line = $derived(samplePath(nib, WIDE, TALL))
  const ink = $derived(shownInk(nib.colour))
  const multiply = $derived(INK_STYLES[nib.tool].multiply)

  const shown = $derived(nib.colour === 'ink' ? null : nib.colour)

  function setTool(tool: InkTool) {
    tick()
    pens.set(nibFor(tool, nib.colour))
  }

  function setColour(colour: string | null) {
    tick()
    pens.set({ colour: colour ?? DEFAULT_INK })
  }
</script>

<div class="pen">
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
        <Glyph node={PEN_ICONS[tool]} />
        <span>{PEN_NAMES[tool]()}</span>
      </button>
    {/each}
  </div>

  <CanvasDial
    value={nib.size}
    least={LEAST_WIDTH}
    most={MOST_WIDTH}
    step={0.5}
    label="Width"
    reading={String(nib.size)}
    onvalue={(size: number) => pens.set({ size })}
  />

  <CanvasDial
    value={nib.opacity}
    least={0.05}
    most={1}
    step={0.05}
    label="Opacity"
    reading="{Math.round(nib.opacity * 100)}%"
    onvalue={(opacity: number) => pens.set({ opacity })}
  />

  <CanvasColours
    colour={shown}
    recent={pens.recent}
    bare={{ css: 'var(--text-strong)', title: 'The ink of the page' }}
    oncolour={setColour}
  />

  <div class="rest">
    <button
      type="button"
      class:on={pens.straighten}
      title="Straighten"
      aria-label="Straighten"
      aria-pressed={pens.straighten}
      onclick={() => {
        tick()
        pens.straightening(!pens.straighten)
      }}
    >
      <Glyph node={MARKS.straight} />
      <span>Straighten</span>
    </button>

    {#if hand.penSeen}
      <button
        type="button"
        class:on={hand.fingerDraws}
        title="Finger draws"
        aria-label="Finger draws"
        aria-pressed={hand.fingerDraws}
        onclick={() => {
          tick()
          hand.toggleFinger()
        }}
      >
        <Glyph node={MARKS.finger} />
        <span>Finger draws</span>
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
    text-align: start;
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
