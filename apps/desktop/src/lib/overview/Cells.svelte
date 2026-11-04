<script lang="ts">
  /** The spaces' cells in All spaces: a membrane round each space's windows, moving on
   *  its own every frame, stretched by a window held against it (issue #331). What a
   *  membrane does is membrane.ts; this keeps one per space, moves each to its space's
   *  windows on springs, and draws them, every frame for as long as it is up. Every frame
   *  it is handed the windows of each cell as they are drawn at that moment, which the
   *  membrane never leaves out, whatever its springs are doing. Asked for less movement,
   *  the membranes stand still and follow at once. */

  import { onDestroy } from 'svelte'
  import { stillness } from '../motion'
  import type { Box } from './layout'
  import { Membrane } from './membrane'
  import { resting, spring, step, type Spring } from './spring'

  interface Shown {
    key: string
    box: Box
    name: string
    tint: string | null
    on: boolean
  }

  const {
    cells,
    pushed,
    holding,
    inside,
    out,
  }: {
    /** Whether the windows are out on the canvas, or on their way home. */
    out: boolean
    cells: readonly Shown[]
    /** The windows in a cell, where each is drawn this frame, read every frame. */
    inside: (key: string) => readonly Box[]
    /** Whether a window is held, which a membrane standing still wakes for. */
    holding: boolean
    /** The window held, and the cell it is in now, read every frame. */
    pushed: () => { key: string; box: Box } | null
  } = $props()

  interface Kept {
    membrane: Membrane
    box: Record<'x' | 'y' | 'w' | 'h', Spring>
    path: SVGPathElement | null
    name: HTMLElement | null
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const kept = new Map<string, Kept>()

  function keptOf(cell: Shown): Kept {
    const known = kept.get(cell.key)
    if (known) return known
    const made: Kept = {
      membrane: new Membrane({ ...cell.box }),
      box: {
        x: spring(cell.box.x),
        y: spring(cell.box.y),
        w: spring(cell.box.w),
        h: spring(cell.box.h),
      },
      path: null,
      name: null,
    }
    kept.set(cell.key, made)
    return made
  }

  function drawn(node: SVGPathElement, key: string) {
    const cell = cells.find((one) => one.key === key)
    if (cell) keptOf(cell).path = node
    return {
      destroy() {
        kept.delete(key)
      },
    }
  }

  function named(node: HTMLElement, key: string) {
    const cell = cells.find((one) => one.key === key)
    if (cell) keptOf(cell).name = node
    return {
      destroy() {
        const one = kept.get(key)
        if (one?.name === node) one.name = null
      },
    }
  }

  /** The cell a window was last in, so its arrival in another is a plop. */
  let lastIn: string | null = null
  let frame = 0
  let before = performance.now()

  function tick(now: number) {
    const seconds = Math.max(0, (now - before) / 1000)
    before = now
    const still = stillness()
    const hand = pushed()
    if (hand && lastIn && hand.key !== lastIn && !still) {
      // The plop: the cell it left springs back in, the one it arrived in gives.
      const middle = { x: hand.box.x + hand.box.w / 2, y: hand.box.y + hand.box.h / 2 }
      kept.get(lastIn)?.membrane.shove(middle, -260)
      kept.get(hand.key)?.membrane.shove(middle, 340)
    }
    lastIn = hand?.key ?? null

    for (const cell of cells) {
      const one = keptOf(cell)
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        one.box[key].to = cell.box[key]
        if (still) one.box[key].at = cell.box[key]
        else step(one.box[key], seconds)
      }
      one.membrane.box = { x: one.box.x.at, y: one.box.y.at, w: one.box.w.at, h: one.box.h.at }
      const own = inside(cell.key)
      one.membrane.step(
        seconds,
        now / 1000,
        hand?.key === cell.key ? [...own, hand.box] : own,
        still,
      )
      one.path?.setAttribute('d', one.membrane.pathOf())
      // The name rides the top of the membrane, just over it.
      const crown = one.membrane.crown()
      if (one.name) one.name.style.translate = `${crown.x}px ${crown.y}px`
    }

    // Never still, unless asked to be: then only while something is moving.
    const moving =
      !still ||
      hand !== null ||
      [...kept.values()].some((one) => Object.values(one.box).some((s) => !resting(s)))
    frame = moving ? requestAnimationFrame(tick) : 0
  }

  /** A change of cells, or a window taken hold of, wakes a loop that stood still. */
  $effect(() => {
    if ((cells.length || holding) && !frame) {
      before = performance.now()
      frame = requestAnimationFrame(tick)
    }
  })

  onDestroy(() => cancelAnimationFrame(frame))
</script>

<svg class="cells" class:is-out={out} width="1" height="1" aria-hidden="true">
  {#each cells as cell (cell.key)}
    <path
      class="membrane"
      class:is-on={cell.on}
      style:--tint={cell.tint ?? 'var(--accent)'}
      use:drawn={cell.key}
    />
  {/each}
</svg>
{#each cells as cell (cell.key)}
  <span
    class="name"
    class:is-on={cell.on}
    class:is-out={out}
    aria-hidden="true"
    use:named={cell.key}>{cell.name}</span
  >
{/each}

<style>
  .cells {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    pointer-events: none;
  }

  /* In with the windows and out with them, never there before them or after. */
  .cells,
  .name {
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
  }

  .is-out {
    opacity: 1;
  }

  /* A membrane: a faint wash of the space's colour inside, a soft line at its edge. */
  .membrane {
    fill: color-mix(in srgb, var(--tint) 7%, transparent);
    stroke: color-mix(in srgb, var(--tint) 45%, transparent);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }

  .membrane.is-on {
    fill: color-mix(in srgb, var(--tint) 11%, transparent);
    stroke: color-mix(in srgb, var(--tint) 70%, transparent);
  }

  /* A space's name, over the top of its membrane, at the overview's own size for it
     whatever the zoom (Overview.svelte's tokens). */
  .name {
    position: absolute;
    top: 0;
    left: 0;
    color: var(--muted);
    font-size: var(--overview-cell-name);
    font-weight: var(--weight-strong);
    white-space: nowrap;
    pointer-events: none;
    transform-origin: 0 0;
    scale: var(--overview-unzoom);
    transform: translate(-50%, calc(-100% - var(--space-2)));
  }

  .name.is-on {
    color: var(--text-strong);
  }
</style>
