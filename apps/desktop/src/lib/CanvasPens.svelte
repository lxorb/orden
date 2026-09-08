<script lang="ts">
  /** The pen bar a finger gets: one row against one edge, holding the pens you
   *  keep and the four things a hand does with them.
   *
   *  A row of small grey glyphs is a bar for a mouse. A thumb wants targets it
   *  cannot miss and pictures it can read while it is covering half of them, so
   *  the pens here are drawn as pens - a nib, a sharpened pencil, a fat chisel -
   *  each standing in the ink it writes, the one in your hand lifted out of the
   *  row the way a pen is lifted out of a tray. Pressing it again opens it up.
   *
   *  Where it sits is the reader's, not ours. A right hand writing on a tablet
   *  wants the bar out from under its wrist; the same tablet held the other way
   *  wants it back. So the grip drags it to either edge and a press folds it away
   *  to a handle, and the device remembers, because the answer belongs to the
   *  device and not to the person; see `pens.svelte.ts`.
   *
   *  It stops every pointer at itself. The plane behind treats a press as a
   *  gesture, and a bar that let one through would clear the selection its own
   *  buttons are for. */

  import { MARKS, HOLDING, PEN_NAMES, PLACING } from './canvas/glyphs'
  import { MOST_PENS, type Nib, pens } from './canvas/pens.svelte'
  import { PEN_ART, PEN_BOX } from './canvas/nibs'
  import { shownColour } from './canvas/palette'
  import { tick } from './canvas/tick'
  import { tools } from './canvas/tools.svelte'
  import { type Tool } from './canvas/pointer'
  import CanvasColours from './CanvasColours.svelte'
  import CanvasNib from './CanvasNib.svelte'
  import CanvasRub from './CanvasRub.svelte'
  import { t } from './i18n.svelte'

  const {
    colour,
    colouring,
    canundo,
    canredo,
    oncolour,
    onundo,
    onredo,
    onerase,
  }: {
    /** The colour whatever the moment is about is wearing. */
    colour: string | null
    /** Whether anything is picked, which is what a colour would colour. */
    colouring: boolean
    canundo: boolean
    canredo: boolean
    oncolour: (colour: string | null) => void
    onundo: () => void
    onredo: () => void
    /** Every stroke on the plane, gone. */
    onerase: () => void
  } = $props()

  /** Which panel is open above the bar, if any. One at a time: two panels over a
   *  drawing is a dialog box, and this is a bar. */
  let open = $state<'nib' | 'rub' | 'colour' | 'more' | null>(null)

  /** Which pen a finger is dragging along the row, while one is. */
  let dragging = $state<number | null>(null)

  /** The buttons the pens are drawn on, so a drag can ask which one it is over
   *  rather than being told how wide they are. */
  const slots: (HTMLButtonElement | undefined)[] = []

  /** How long a finger has to stay on a pen before the press becomes a drag, in
   *  milliseconds. Long enough that scrolling the row is not a reorder, short
   *  enough that it is not a wait. */
  const HOLD = 340

  let held = 0

  /** The tools the bar shows outside the pens: the two a hand uses to get about,
   *  and the two the pens are used with. */
  const ABOUT = HOLDING.filter((one) => one.id === 'select' || one.id === 'hand')
  const ERASE = HOLDING.find((one) => one.id === 'erase')
  const LASSO = HOLDING.find((one) => one.id === 'lasso')

  const nib = $derived(pens.current)
  const drawing = $derived(tools.which === 'draw')

  function shut() {
    open = null
  }

  /** A press on a tool: it comes out, and pressing the one that is already out
   *  opens its settings. The one gesture nobody has to be told. */
  function press(panel: 'nib' | 'rub', tool: Tool, already: boolean) {
    tick()

    if (already) {
      open = open === panel ? null : panel
      return
    }

    open = null
    tools.choose(tool)
  }

  function pickPen(index: number) {
    if (pens.at === index && drawing) {
      tick()
      open = open === 'nib' ? null : 'nib'
      return
    }

    tick()
    open = null
    tools.pickPen(index)
  }

  /** Which pen of the row a point is over, by asking the buttons where they are.
   *  Nothing when the point is off the end, so a drag that leaves the row leaves
   *  the order alone. */
  function slotAt(x: number): number | null {
    for (const [index, slot] of slots.entries()) {
      if (!slot) continue

      const box = slot.getBoundingClientRect()
      if (x >= box.left && x <= box.right) return index
    }

    return null
  }

  function onPenDown(event: PointerEvent, index: number) {
    const button = event.currentTarget
    if (!(button instanceof HTMLButtonElement)) return

    window.clearTimeout(held)
    held = window.setTimeout(() => {
      dragging = index
      tick()
      button.setPointerCapture(event.pointerId)
    }, HOLD)
  }

  function onPenMove(event: PointerEvent) {
    if (dragging === null) {
      // Still deciding: a finger that has set off along the row is scrolling it,
      // not picking a pen up.
      window.clearTimeout(held)
      return
    }

    const over = slotAt(event.clientX)
    if (over === null || over === dragging) return

    pens.move(dragging, over)
    dragging = over
    tick()
  }

  function onPenUp() {
    window.clearTimeout(held)
    dragging = null
  }

  /** The grip: dragged, it moves the bar to an edge; pressed, it folds it away.
   *  Two answers from one control, because both are the same question about where
   *  the bar should be. */
  let grabbed = $state(false)
  let from = 0

  function onGripDown(event: PointerEvent) {
    const grip = event.currentTarget
    if (!(grip instanceof HTMLElement)) return

    grabbed = true
    from = event.clientY
    grip.setPointerCapture(event.pointerId)
  }

  function onGripUp(event: PointerEvent) {
    if (!grabbed) return

    grabbed = false
    const moved = Math.abs(event.clientY - from)

    tick()
    if (moved < 12) {
      pens.fold(true)
      open = null
      return
    }

    pens.dockTo(event.clientY < window.innerHeight / 2 ? 'top' : 'bottom')
  }

  /** The nib of a pen, in the ink it writes and at the alpha it writes at, so the
   *  drawing of the pen is also the swatch for its colour. */
  function inkOf(one: Nib): string {
    return shownColour(one.colour) ?? 'var(--text-strong)'
  }
</script>

<svelte:window onpointerdown={shut} onblur={shut} />

<!-- Every pointer stops here. See the note at the top of the file. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cluster"
  class:top={pens.dock === 'top'}
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
>
  {#if pens.shut}
    <!-- Folded away: the pen you were holding, and nothing else. A landscape
         tablet gets its whole page back and the way in is still in your hand. -->
    <button
      class="tab"
      title={t('The pens')}
      aria-label={t('The pens')}
      onclick={() => {
        tick()
        pens.fold(false)
      }}
    >
      <svg class="pen" viewBox="0 0 {PEN_BOX.width} {PEN_BOX.height}" aria-hidden="true">
        <path class="barrel" d={PEN_ART[nib.tool].barrel} />
        <path class="detail" d={PEN_ART[nib.tool].detail} />
        <path
          class="tip"
          d={PEN_ART[nib.tool].nib}
          fill-rule="evenodd"
          style:fill={inkOf(nib)}
          style:fill-opacity={nib.opacity}
        />
      </svg>
    </button>
  {:else}
    {#if open}
      <div class="panel">
        {#if open === 'nib'}
          <CanvasNib
            {nib}
            {oncolour}
            onremove={pens.list.length > 1 ? () => pens.remove(pens.at) : null}
          />
        {:else if open === 'rub'}
          <CanvasRub {onerase} />
        {:else if open === 'colour'}
          <CanvasColours {colour} recent={pens.recent} none={colouring} {oncolour} />
        {:else}
          <div class="more">
            {#each PLACING as one (one.id)}
              <button
                class:on={tools.which === one.id}
                title={one.title}
                aria-label={one.title}
                aria-pressed={tools.which === one.id}
                onclick={() => {
                  tick()
                  tools.choose(one.id)
                  shut()
                }}
              >
                <svg class="glyph" viewBox="0 0 14 14"><path d={one.path} /></svg>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="bar">
      <span
        class="grip"
        class:grabbed
        role="separator"
        aria-label={t('Move the bar')}
        title={t('Move the bar')}
        onpointerdown={onGripDown}
        onpointerup={onGripUp}
        onpointercancel={() => (grabbed = false)}
      ></span>

      <div class="scroller">
        {#each ABOUT as one (one.id)}
          <button
            class:on={tools.which === one.id}
            title={one.title}
            aria-label={one.title}
            aria-pressed={tools.which === one.id}
            onclick={() => {
              tick()
              shut()
              tools.choose(one.id)
            }}
          >
            <svg class="glyph" viewBox="0 0 14 14"><path d={one.path} /></svg>
          </button>
        {/each}

        <span class="split"></span>

        <!-- The pens. Each is the pen it is, in the ink it writes; the one in
             hand stands out of the row. -->
        {#each pens.list as one, index (index)}
          <button
            bind:this={slots[index]}
            class="pen-slot"
            class:out={pens.at === index && drawing}
            class:lifting={dragging === index}
            title={PEN_NAMES[one.tool]}
            aria-label={PEN_NAMES[one.tool]}
            aria-pressed={pens.at === index && drawing}
            onclick={() => pickPen(index)}
            onpointerdown={(event) => onPenDown(event, index)}
            onpointermove={onPenMove}
            onpointerup={onPenUp}
            onpointercancel={onPenUp}
          >
            <svg class="pen" viewBox="0 0 {PEN_BOX.width} {PEN_BOX.height}" aria-hidden="true">
              <path class="barrel" d={PEN_ART[one.tool].barrel} />
              <path class="detail" d={PEN_ART[one.tool].detail} />
              <path
                class="tip"
                d={PEN_ART[one.tool].nib}
                fill-rule="evenodd"
                style:fill={inkOf(one)}
                style:fill-opacity={one.opacity}
              />
            </svg>
          </button>
        {/each}

        {#if pens.list.length < MOST_PENS}
          <button
            class="add"
            title={t('Keep this pen')}
            aria-label={t('Keep this pen')}
            onclick={() => {
              tick()
              pens.add(nib.tool)
              open = 'nib'
            }}
          >
            <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.plus} /></svg>
          </button>
        {/if}

        <span class="split"></span>

        {#if ERASE}
          <button
            class:on={tools.which === 'erase'}
            title={ERASE.title}
            aria-label={ERASE.title}
            aria-pressed={tools.which === 'erase'}
            onclick={() => press('rub', 'erase', tools.which === 'erase')}
          >
            <svg class="glyph" viewBox="0 0 14 14"><path d={ERASE.path} /></svg>
          </button>
        {/if}

        {#if LASSO}
          <button
            class:on={tools.which === 'lasso'}
            title={LASSO.title}
            aria-label={LASSO.title}
            aria-pressed={tools.which === 'lasso'}
            onclick={() => {
              tick()
              shut()
              tools.choose('lasso')
            }}
          >
            <svg class="glyph" viewBox="0 0 14 14"><path d={LASSO.path} /></svg>
          </button>
        {/if}

        <span class="split"></span>

        <button
          title={t('Undo')}
          aria-label={t('Undo')}
          disabled={!canundo}
          onclick={() => {
            tick()
            onundo()
          }}
        >
          <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.undo} /></svg>
        </button>

        <button
          title={t('Redo')}
          aria-label={t('Redo')}
          disabled={!canredo}
          onclick={() => {
            tick()
            onredo()
          }}
        >
          <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.redo} /></svg>
        </button>

        <span class="split"></span>

        <!-- The colour of whatever the moment is about: what is picked, or the
             pen. One question, one dot, one row behind it. -->
        <button
          class="swatch"
          class:on={open === 'colour'}
          title={t('Colour')}
          aria-label={t('Colour')}
          aria-pressed={open === 'colour'}
          style:--dot={colour === null ? 'transparent' : (shownColour(colour) ?? 'transparent')}
          onclick={() => {
            tick()
            open = open === 'colour' ? null : 'colour'
          }}
        ></button>

        <button
          class:on={open === 'more'}
          title={t('Add')}
          aria-label={t('Add')}
          aria-pressed={open === 'more'}
          onclick={() => {
            tick()
            open = open === 'more' ? null : 'more'
          }}
        >
          <svg class="glyph" viewBox="0 0 14 14"><path d={MARKS.more} /></svg>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Against one edge of the pane and across it, clear of whatever the system
     puts in the corners. */
  .cluster {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: calc(var(--space-2) + var(--inset-bottom));
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    animation: rise var(--dur-stage) var(--ease-out);
  }

  .cluster.top {
    bottom: auto;
    top: calc(var(--space-2) + var(--inset-top));
    flex-direction: column-reverse;
    animation: fall var(--dur-stage) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 10px;
    }
  }

  @keyframes fall {
    from {
      opacity: 0;
      translate: 0 -10px;
    }
  }

  /* A phone keeps the app's own round button in the bottom right corner clear. */
  :global([data-device='phone']) .cluster:not(.top) {
    right: calc(var(--space-2) + 60px);
  }

  .bar {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
  }

  /* One row that scrolls sideways rather than a bar that hides half of itself
     behind a menu, which is what a phone needs and a tablet in portrait wants. */
  .scroller {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .scroller::-webkit-scrollbar {
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
    background: var(--surface-2);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  button:disabled {
    opacity: 0.3;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .glyph {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .split {
    flex: none;
    width: 1px;
    align-self: center;
    height: 24px;
    margin: 0 5px;
    background: var(--line-strong);
  }

  /* ── The pens ──────────────────────────────────────────────────── */

  /* A pen stands on its nib, pointing away from the edge the bar is against, and
     the row is tall enough that the one in hand can rise out of it without the
     scroller clipping it. */
  .pen-slot {
    min-width: 40px;
    height: 60px;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    align-items: end;
    background: none;
  }

  .cluster.top .pen-slot {
    align-items: start;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  .pen {
    width: 24px;
    height: 48px;
    /* Tucked into the bar until it is the one in hand. */
    translate: 0 9px;
    rotate: 180deg;
    transition:
      translate var(--dur-stage) var(--ease-spring),
      scale var(--dur-fast) var(--ease-out);
  }

  .cluster.top .pen {
    translate: 0 -9px;
    rotate: none;
  }

  .pen-slot.out .pen,
  .cluster.top .pen-slot.out .pen {
    translate: 0 0;
  }

  /* The one being dragged along the row comes up off the bar. */
  .pen-slot.lifting {
    background: var(--accent-soft);
  }

  .pen-slot.lifting .pen {
    scale: 1.12;
  }

  .barrel {
    fill: var(--line-strong);
  }

  .detail {
    fill: var(--muted);
  }

  /* A hairline round the nib, so a pen writing in white or in the page's own ink
     is still a pen and not a gap. */
  .tip {
    stroke: var(--muted);
    stroke-width: 0.6;
  }

  .add {
    min-width: 36px;
    height: 60px;
    align-items: center;
  }

  /* ── The grip, and the handle it folds to ──────────────────────── */

  /* Two lines, the way a thing that moves is drawn everywhere. */
  .grip {
    flex: none;
    width: 22px;
    align-self: stretch;
    border-radius: var(--radius-md);
    background:
      linear-gradient(var(--line-strong), var(--line-strong)) center left 8px / 1.5px 20px no-repeat,
      linear-gradient(var(--line-strong), var(--line-strong)) center left 12px / 1.5px 20px
        no-repeat;
    touch-action: none;
    transition: background-color var(--dur-instant) var(--ease-out);
  }

  .grip.grabbed {
    background-color: var(--accent-soft);
  }

  /* Folded: one pen against the edge, in from the corner so a thumb resting
     there does not open it. */
  .tab {
    align-self: flex-start;
    min-width: 54px;
    height: 40px;
    margin-left: var(--space-5);
    align-items: end;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-bottom: none;
    box-shadow: var(--shadow-md);
  }

  .cluster.top .tab {
    align-items: start;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    border-bottom: 1px solid var(--line-strong);
    border-top: none;
  }

  .tab .pen {
    width: 20px;
    height: 40px;
    translate: 0 4px;
  }

  .cluster.top .tab .pen {
    translate: 0 -4px;
  }

  /* ── The panel over the bar ────────────────────────────────────── */

  /* Beside the grip rather than across the pane: a panel the width of a tablet
     would be a dialog box. */
  .panel {
    align-self: flex-start;
    box-sizing: border-box;
    width: min(21rem, 100%);
    padding: var(--space-2);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: lift var(--dur-fast) var(--ease-out);
  }

  @keyframes lift {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }

  .cluster.top .panel {
    animation-name: sink;
  }

  @keyframes sink {
    from {
      opacity: 0;
      translate: 0 -6px;
    }
  }

  /* Everything a press can put on the plane, as a grid rather than a list: eight
     shapes read faster than eight lines of words. */
  .more {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
  }

  .more button {
    width: 100%;
  }

  /* The colour in hand, drawn as the dot it is. */
  .swatch {
    min-width: var(--touch-target);
  }

  .swatch::after {
    content: '';
    display: block;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 2px var(--muted);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:active::after {
    scale: 1.08;
  }
</style>
