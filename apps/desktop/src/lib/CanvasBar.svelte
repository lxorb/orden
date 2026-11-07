<script lang="ts">
  import CanvasCatch from './CanvasCatch.svelte'
  import CanvasColours from './CanvasColours.svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import CanvasPen from './CanvasPen.svelte'
  import CanvasPlace from './CanvasPlace.svelte'
  import CanvasRub from './CanvasRub.svelte'
  import {
    ABOUT,
    hinted,
    MARKS,
    PEN_ICONS,
    PEN_NAMES,
    PLACING,
    RUBBING,
    type ToolMark,
    WORDS,
  } from './canvas/glyphs'
  import { hand } from './canvas/hand.svelte'
  import { DEFAULT_INK, shownInk } from './canvas/palette'
  import { nearestDock, pens, upright } from './canvas/pens.svelte'
  import { frameOf } from './pane-corners.svelte'
  import { type Tool } from './canvas/pointer'
  import { tick } from './canvas/tick'
  import { shortcuts } from './shortcuts.svelte'
  import { tools } from './canvas/tools.svelte'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { overlays } from './overlays'
  import { viewport } from './viewport.svelte'

  const {
    canundo,
    canredo,
    onundo,
    onredo,
    onerase,
    places = true,
    scale,
    onactual,
  }: {
    canundo: boolean
    canredo: boolean
    onundo: () => void
    onredo: () => void
    onerase: () => void
    places?: boolean
    scale?: number
    onactual?: () => void
  } = $props()

  const zoomed = $derived(
    scale !== undefined && onactual && Math.abs(scale - 1) >= 0.005
      ? `${String(Math.round(scale * 100))}%`
      : null,
  )

  const early = $derived(viewport.device === 'phone')

  let scroller = $state<HTMLElement>()

  const follows = (..._values: unknown[]) => undefined
  let fades = $state({ start: false, end: false })

  function measure() {
    const row = scroller
    if (!row) return
    const along = standing
      ? { at: row.scrollTop, seen: row.clientHeight, whole: row.scrollHeight }
      : { at: Math.abs(row.scrollLeft), seen: row.clientWidth, whole: row.scrollWidth }
    const start = along.at > 1
    const end = along.at + along.seen < along.whole - 1
    if (start !== fades.start || end !== fades.end) fades = { start, end }
  }

  $effect(() => {
    const row = scroller
    if (!row) return
    follows(standing)
    if (typeof ResizeObserver === 'undefined') {
      measure()
      return
    }
    const watcher = new ResizeObserver(measure)
    watcher.observe(row)
    for (const one of row.children) watcher.observe(one)
    return () => watcher.disconnect()
  })

  type Panel = 'pen' | 'rub' | 'catch' | 'put' | 'colour'
  let open = $state<Panel | null>(null)

  let popAt = $state(0)
  let cluster = $state<HTMLElement>()

  const A_TWITCH = 12

  const nib = $derived(pens.current)
  const drawing = $derived(tools.which === 'draw')

  const putting = $derived(PLACING.find((one) => one.id === tools.which))

  const movable = $derived(viewport.touch || hand.penSeen)

  $effect(() =>
    open
      ? overlays.show(
          () => (open = null),
          () => [cluster],
        )
      : undefined,
  )
  $effect(() => closeOnBack(open !== null, () => (open = null)))

  function shut() {
    open = null
  }

  let was = tools.which
  $effect(() => {
    if (tools.which === was) return

    was = tools.which
    open = null
  })

  function anchor(event: Event) {
    const button = event.currentTarget
    const box = cluster?.getBoundingClientRect()
    if (!(button instanceof HTMLElement) || !box) return

    const own = button.getBoundingClientRect()
    popAt = upright(pens.dock)
      ? own.top + own.height / 2 - box.top
      : own.left + own.width / 2 - box.left
  }

  function toggle(panel: Panel, event: Event) {
    anchor(event)
    open = open === panel ? null : panel
  }

  function panelFor(tool: Tool): Panel | null {
    if (tool === 'erase') return 'rub'
    if (tool === 'lasso') return 'catch'
    return null
  }

  function pressTool(mark: ToolMark, event: Event) {
    tick()
    const panel = panelFor(mark.id)

    if (tools.which === mark.id && panel) {
      toggle(panel, event)
      return
    }

    open = null
    tools.choose(mark.id)
  }

  function pressPen(index: number, event: Event) {
    tick()

    if (drawing && pens.at === index) {
      toggle('pen', event)
      return
    }

    open = null
    tools.pickPen(index)
  }

  let grabbed = $state(false)
  let carried = $state.raw<{ x: number; y: number } | null>(null)
  let from = { x: 0, y: 0 }

  function onGripDown(event: PointerEvent) {
    const grip = event.currentTarget
    if (!(grip instanceof HTMLElement)) return

    grabbed = true
    carried = { x: 0, y: 0 }
    from = { x: event.clientX, y: event.clientY }
    grip.setPointerCapture(event.pointerId)
  }

  function onGripMove(event: PointerEvent) {
    if (!grabbed) return

    carried = { x: event.clientX - from.x, y: event.clientY - from.y }
  }

  function onGripUp(event: PointerEvent) {
    if (!grabbed) return

    grabbed = false
    tick()

    const went = Math.hypot(event.clientX - from.x, event.clientY - from.y)
    if (went < A_TWITCH) {
      carried = null
      pens.fold(true)
      open = null
      return
    }

    const box = cluster?.getBoundingClientRect()
    const middle = box
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: event.clientX, y: event.clientY }

    const frame = frameOf(cluster)
    pens.dockTo(
      nearestDock({ x: middle.x - frame.left, y: middle.y - frame.top }, frame.width, frame.height),
    )
    carried = null
    open = null
  }

  function onGripLost() {
    grabbed = false
    carried = null
  }

  const standing = $derived(upright(pens.dock))

  const swatch = $derived(shownInk(nib.colour))
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cluster"
  class:top={pens.dock === 'top'}
  class:left={pens.dock === 'left'}
  class:right={pens.dock === 'right'}
  class:standing
  class:carrying={carried !== null}
  style:translate={carried ? `${carried.x}px ${carried.y}px` : undefined}
  bind:this={cluster}
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
>
  {#if pens.shut}
    <button
      type="button"
      class="tab"
      title={t('The pens')}
      aria-label={t('The pens')}
      onclick={() => {
        tick()
        pens.fold(false)
      }}
    >
      <CanvasIcon node={PEN_ICONS[nib.tool]} />
    </button>
  {:else}
    {#if open}
      <div class="orden-layer panel" style:--pop="{popAt}px">
        {#if open === 'pen'}
          <CanvasPen {nib} />
        {:else if open === 'rub'}
          <CanvasRub {onerase} />
        {:else if open === 'catch'}
          <CanvasCatch />
        {:else if open === 'put'}
          <CanvasPlace
            onchoose={(tool: Tool) => {
              tools.choose(tool)
              shut()
            }}
          />
        {:else}
          <CanvasColours
            colour={nib.colour === DEFAULT_INK ? null : nib.colour}
            recent={pens.recent}
            bare={{ css: 'var(--text-strong)', title: t('The ink of the page') }}
            oncolour={(colour: string | null) => pens.set({ colour: colour ?? DEFAULT_INK })}
          />
        {/if}
      </div>
    {/if}

    <div class="bar">
      {#if movable}
        <span
          class="grip"
          class:grabbed
          role="separator"
          aria-label={t('Move the bar')}
          title={t('Move the bar')}
          onpointerdown={onGripDown}
          onpointermove={onGripMove}
          onpointerup={onGripUp}
          onpointercancel={onGripLost}
        >
          <CanvasIcon node={MARKS.grip} />
        </span>
      {/if}

      <div
        class="scroller"
        class:fade-start={fades.start}
        class:fade-end={fades.end}
        bind:this={scroller}
        onscroll={measure}
      >
        {#snippet arrows()}
          <button
            type="button"
            title={shortcuts.tooltip(t('Undo'), 'edit.undo')}
            aria-label={t('Undo')}
            disabled={!canundo}
            onclick={() => {
              tick()
              onundo()
            }}
          >
            <CanvasIcon node={MARKS.undo} />
          </button>

          <button
            type="button"
            title={shortcuts.tooltip(t('Redo'), 'edit.redo')}
            aria-label={t('Redo')}
            disabled={!canredo}
            onclick={() => {
              tick()
              onredo()
            }}
          >
            <CanvasIcon node={MARKS.redo} />
          </button>
        {/snippet}

        {#if early}
          {@render arrows()}
          <span class="split"></span>
        {/if}

        {#snippet holding(mark: ToolMark)}
          <button
            type="button"
            class:on={tools.which === mark.id}
            class:deeper={tools.which === mark.id && panelFor(mark.id) !== null}
            title={hinted(mark)}
            aria-label={mark.title()}
            aria-pressed={tools.which === mark.id}
            onclick={(event) => pressTool(mark, event)}
          >
            <CanvasIcon node={mark.icon} />
          </button>
        {/snippet}

        {#each ABOUT as one (one.id)}
          {@render holding(one)}
        {/each}

        <span class="split"></span>

        {#each pens.list as one, index (index)}
          {@const out = drawing && pens.at === index}
          <button
            type="button"
            class="pen"
            class:on={out}
            class:deeper={out}
            title={out
              ? hinted({ title: PEN_NAMES[one.tool], key: 'canvas.tool.draw' })
              : PEN_NAMES[one.tool]()}
            aria-label={PEN_NAMES[one.tool]()}
            aria-pressed={out}
            style:--ink={shownInk(one.colour)}
            onclick={(event) => pressPen(index, event)}
          >
            <CanvasIcon node={PEN_ICONS[one.tool]} />
          </button>
        {/each}

        {#each RUBBING as one (one.id)}
          {@render holding(one)}
        {/each}

        <span class="split"></span>

        {@render holding(WORDS)}

        {#if places}
          <button
            type="button"
            class:on={open === 'put' || putting !== undefined}
            class:deeper={putting !== undefined}
            title={putting ? hinted(putting) : t('Add')}
            aria-label={putting ? putting.title() : t('Add')}
            aria-pressed={open === 'put'}
            onclick={(event) => {
              tick()
              toggle('put', event)
            }}
          >
            <CanvasIcon node={putting?.icon ?? MARKS.put} />
          </button>
        {/if}

        <button
          type="button"
          class="swatch"
          class:on={open === 'colour'}
          title={t('Colour')}
          aria-label={t('Colour')}
          aria-pressed={open === 'colour'}
          style:--dot={swatch}
          onclick={(event) => {
            tick()
            toggle('colour', event)
          }}
        ></button>

        {#if !early}
          <span class="split"></span>
          {@render arrows()}
        {/if}

        {#if zoomed}
          <button
            type="button"
            class="actual"
            title={t('Actual size')}
            aria-label={t('Actual size')}
            onclick={() => {
              tick()
              onactual?.()
            }}
          >
            {zoomed}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .cluster {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: calc(var(--space-2) + var(--inset-bottom));
    z-index: var(--z-tools);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    animation: rise var(--dur-stage) var(--ease-out);
    pointer-events: none;
  }

  .cluster > * {
    pointer-events: auto;
  }

  .cluster.top {
    bottom: auto;
    top: calc(var(--space-2) + var(--inset-top));
    flex-direction: column-reverse;
    animation: fall var(--dur-stage) var(--ease-out);
  }

  .cluster.left,
  .cluster.right {
    left: auto;
    right: auto;
    top: calc(var(--space-2) + var(--inset-top));
    bottom: calc(var(--space-2) + var(--inset-bottom));
    justify-content: center;
    animation: none;
  }

  .cluster.left {
    left: calc(var(--space-2) + var(--inset-left, 0px));
    flex-direction: row-reverse;
  }

  .cluster.right {
    right: calc(var(--space-2) + var(--inset-right, 0px));
    flex-direction: row;
  }

  :global([dir='rtl']) .cluster.left {
    flex-direction: row;
  }

  :global([dir='rtl']) .cluster.right {
    flex-direction: row-reverse;
  }

  .cluster {
    transition: translate var(--dur-slow) var(--ease-spring);
  }

  .cluster.carrying {
    transition: none;
    cursor: grabbing;
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

  .bar {
    max-width: 100%;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .cluster.standing .bar {
    flex-direction: column;
    max-width: none;
    max-height: 100%;
  }

  .cluster.standing .scroller {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .cluster.standing .split {
    width: 20px;
    height: 1px;
    margin: 5px 0;
  }

  .cluster.standing .grip {
    width: auto;
    height: 22px;
  }

  .cluster.standing .grip :global(svg) {
    rotate: 90deg;
  }

  .cluster.standing .panel {
    align-self: flex-start;
    width: min(21rem, 60vw);
    margin-left: 0;
    margin-top: clamp(0px, calc(var(--pop) - 6rem), max(0px, calc(100% - 12rem)));
  }

  .cluster.standing .tab {
    margin-left: 0;
    margin-top: var(--space-5);
  }

  :global([data-touch]) .cluster.standing .grip {
    width: auto;
    height: 30px;
  }

  .scroller {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: 1px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .scroller::-webkit-scrollbar {
    display: none;
  }

  .scroller.fade-start,
  .scroller.fade-end {
    --fade: 28px;
    --from: 0px;
    --to: 0px;

    mask-image: linear-gradient(
      var(--along, to right),
      transparent 0,
      #000 var(--from),
      #000 calc(100% - var(--to)),
      transparent 100%
    );
  }

  .scroller.fade-start {
    --from: var(--fade);
  }

  .scroller.fade-end {
    --to: var(--fade);
  }

  .cluster.standing .scroller {
    --along: to bottom;
  }

  :global([dir='rtl']) .scroller {
    --along: to left;
  }

  button {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  @media (hover: hover) {
    button:hover:not(:disabled):not(.on) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  button:active:not(:disabled) {
    background: var(--surface-press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .split {
    flex: none;
    width: 1px;
    align-self: center;
    height: 20px;
    margin: 0 var(--space-1);
    background: var(--line-strong);
  }

  .deeper::before {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    border: 3px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
    border-radius: 1px;
  }

  .pen::after {
    content: '';
    position: absolute;
    left: 20%;
    right: 20%;
    bottom: 4px;
    height: 2.5px;
    border-radius: 2px;
    background: var(--ink);
    box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--text) 30%, transparent);
  }

  .actual {
    width: auto;
    min-width: 0;
    padding-inline: var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .swatch::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:active::after {
    scale: 1.08;
  }

  .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    align-self: stretch;
    border-radius: var(--radius-md);
    color: var(--muted);
    touch-action: none;
    transition: background-color var(--dur-instant) var(--ease-out);
  }

  .grip.grabbed {
    background-color: var(--accent-soft);
    color: var(--accent);
  }

  .tab {
    align-self: flex-start;
    min-width: 58px;
    margin-left: var(--space-5);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-bottom: none;
    box-shadow: var(--shadow-md);
  }

  .cluster.top .tab {
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    border-bottom: 1px solid var(--line-strong);
    border-top: none;
  }

  .panel {
    box-sizing: border-box;
    align-self: flex-start;
    width: min(21rem, 100%);
    margin-left: clamp(0px, calc(var(--pop) - 10.5rem), calc(100% - 21rem));
    padding: var(--space-2);
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

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-width: var(--touch-target);
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .swatch::after {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  :global([data-touch]) .grip {
    --mark: var(--touch-icon);

    width: 30px;
  }

  :global([data-touch]) .tab {
    min-height: var(--touch-target);
  }
</style>
