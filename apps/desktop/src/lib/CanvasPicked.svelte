<script lang="ts">
  import CanvasColours from './CanvasColours.svelte'
  import CanvasDial from './CanvasDial.svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import { freshId } from './canvas/format'
  import { MARKS } from './canvas/glyphs'
  import { shownColour } from './canvas/palette'
  import { LEAST_WIDTH, MOST_WIDTH } from './canvas/pens.svelte'
  import { tick } from './canvas/tick'
  import { overlays } from './ui-kit/src/api'

  const {
    at,
    below,
    colour,
    size,
    recent,
    grouping,
    oncolour,
    onsize,
    onduplicate,
    ondelete,
    ongroup,
    onmore,
  }: {
    at: { x: number; y: number }
    below: boolean
    colour: string | null
    size: number | undefined
    recent: readonly string[]
    grouping: 'group' | 'ungroup' | null
    oncolour: (colour: string | null) => void
    onsize: (size: number, run: string) => void
    onduplicate: () => void
    ondelete: () => void
    ongroup: () => void
    onmore: (event: MouseEvent) => void
  } = $props()

  let colouring = $state(false)
  let run = freshId()
  let over = $state<HTMLElement>()

  let wide = $state(0)
  let room = $state(0)

  const MARGIN = 8

  const left = $derived.by(() => {
    if (!wide || !room) return at.x
    if (room < wide + 2 * MARGIN) return room / 2
    return Math.min(Math.max(at.x, wide / 2 + MARGIN), room - wide / 2 - MARGIN)
  })

  $effect(() => {
    const bar = over
    const plane = bar?.parentElement
    if (!bar || !plane || typeof ResizeObserver === 'undefined') return
    const watcher = new ResizeObserver((entries) => {
      for (const one of entries) {
        const size = one.borderBoxSize[0]?.inlineSize ?? one.contentRect.width
        if (one.target === bar) wide = size
        else room = one.contentBoxSize[0]?.inlineSize ?? one.contentRect.width
      }
    })
    watcher.observe(bar)
    watcher.observe(plane)
    return () => watcher.disconnect()
  })

  function pick(next: string | null) {
    colouring = false
    oncolour(next)
  }

  $effect(() =>
    colouring
      ? overlays.show(
          () => (colouring = false),
          () => [over],
        )
      : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="over"
  class:below
  bind:this={over}
  style:left="{left}px"
  style:top="{at.y}px"
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
>
  {#if colouring}
    <div class="panel">
      <CanvasColours {colour} {recent} oncolour={pick} />
      {#if size !== undefined}
        <CanvasDial
          value={size}
          least={LEAST_WIDTH}
          most={MOST_WIDTH}
          step={0.5}
          label="Width"
          reading={String(size)}
          onvalue={(next: number) => onsize(next, run)}
        />
      {/if}
    </div>
  {/if}

  <div class="bar">
    <button
      type="button"
      class="swatch"
      class:on={colouring}
      class:bare={colour === null}
      title="Colour"
      aria-label="Colour"
      aria-pressed={colouring}
      style:--dot={shownColour(colour ?? undefined) ?? 'transparent'}
      onclick={() => {
        tick()
        colouring = !colouring
        run = freshId()
      }}
    ></button>

    <button
      type="button"
      title="Duplicate"
      aria-label="Duplicate"
      onclick={() => {
        tick()
        onduplicate()
      }}
    >
      <CanvasIcon node={MARKS.copy} />
    </button>

    {#if grouping}
      <button
        type="button"
        title={grouping === 'group' ? 'Group' : 'Ungroup'}
        aria-label={grouping === 'group' ? 'Group' : 'Ungroup'}
        onclick={() => {
          tick()
          ongroup()
        }}
      >
        <CanvasIcon node={grouping === 'group' ? MARKS.group : MARKS.ungroup} />
      </button>
    {/if}

    <button
      type="button"
      class="gone"
      title="Delete"
      aria-label="Delete"
      onclick={() => {
        tick()
        ondelete()
      }}
    >
      <CanvasIcon node={MARKS.bin} />
    </button>

    <button
      type="button"
      title="More"
      aria-label="More"
      onclick={(event) => {
        tick()
        colouring = false
        event.stopPropagation()
        onmore(event)
      }}
    >
      <CanvasIcon node={MARKS.rest} />
    </button>
  </div>
</div>

<style>
  .over {
    position: absolute;
    z-index: var(--z-bars);
    width: max-content;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    translate: -50% calc(-100% - var(--space-2));
    animation: arrive var(--dur-fast) var(--ease-out);
  }

  .over.below {
    flex-direction: column-reverse;
    translate: -50% var(--space-2);
  }

  @keyframes arrive {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }

  .bar {
    display: flex;
    align-items: stretch;
    gap: 1px;
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    box-sizing: border-box;
    max-width: 21rem;
    padding: var(--space-2);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  button {
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
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:active {
    background: var(--press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .gone {
    color: var(--danger);
  }

  .gone:active {
    background: var(--danger-soft);
  }

  .swatch::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
  }

  .swatch.bare::after {
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }

  :global([data-touch]) .swatch::after {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
