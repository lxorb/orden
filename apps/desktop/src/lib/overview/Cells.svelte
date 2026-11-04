<script lang="ts">
  /** The spaces' bubbles in All spaces: one round each space's windows, as each is drawn
   *  this frame, and its name over it (issue #331). What a bubble does is bubble.ts; this
   *  keeps one per space, moves each round its windows every frame for as long as it is
   *  up, keeps any two from overlapping, and draws them. A bubble is its windows: one
   *  dragged away takes its bubble and its name with it. Asked for less movement, the
   *  bubbles stand still and follow at once. */

  import { onDestroy } from 'svelte'
  import { stillness } from '../motion'
  import { apart, Bubble } from './bubble'
  import type { Box } from './layout'

  interface Shown {
    key: string
    name: string
    tint: string | null
    on: boolean
  }

  const {
    cells,
    pushed,
    holding,
    inside,
  }: {
    cells: readonly Shown[]
    /** The windows in a cell, where each is drawn this frame, read every frame. */
    inside: (key: string) => readonly Box[]
    /** Whether a window is held, which a bubble standing still wakes for. */
    holding: boolean
    /** The window held, and the cell it is in now, read every frame. */
    pushed: () => { key: string; box: Box } | null
  } = $props()

  interface Kept {
    bubble: Bubble
    path: SVGPathElement | null
    name: HTMLElement | null
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const kept = new Map<string, Kept>()

  /** A cell's windows this frame, the held one with them while it is in this cell. */
  function boxesOf(key: string, hand: { key: string; box: Box } | null): readonly Box[] {
    const own = inside(key)
    return hand?.key === key ? [...own, hand.box] : own
  }

  function keptOf(key: string): Kept {
    const known = kept.get(key)
    if (known) return known
    const made: Kept = { bubble: new Bubble(boxesOf(key, pushed())), path: null, name: null }
    kept.set(key, made)
    return made
  }

  function drawn(node: SVGPathElement, key: string) {
    keptOf(key).path = node
    return {
      destroy() {
        kept.delete(key)
      },
    }
  }

  function named(node: HTMLElement, key: string) {
    keptOf(key).name = node
    return {
      destroy() {
        const one = kept.get(key)
        if (one?.name === node) one.name = null
      },
    }
  }

  let frame = 0
  let before = performance.now()
  /** What each cell's windows were last frame, so a bubble standing still knows to move. */
  let last = ''

  function tick(now: number) {
    const seconds = Math.max(0, (now - before) / 1000)
    before = now
    const still = stillness()
    const hand = pushed()
    const all = cells.map((cell) => ({
      cell,
      one: keptOf(cell.key),
      boxes: boxesOf(cell.key, hand),
    }))
    for (const { one, boxes } of all) one.bubble.step(seconds, now / 1000, boxes, still)
    // No two overlap: where they would, they meet along a line between their windows.
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (a && b) apart(a.one.bubble, b.one.bubble, a.boxes, b.boxes)
      }
    }
    for (const { one } of all) {
      one.path?.setAttribute('d', one.bubble.pathOf())
      // The name rides the top of the bubble, just over it, wherever its windows took it.
      const crown = one.bubble.crown()
      if (one.name) one.name.style.translate = `${crown.x}px ${crown.y}px`
    }

    // Never still, unless asked to be: then only while something is moving.
    const seen = JSON.stringify(all.map(({ boxes }) => boxes))
    const moving = !still || hand !== null || seen !== last
    last = seen
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

<svg class="cells" width="1" height="1" aria-hidden="true">
  {#each cells as cell (cell.key)}
    <path
      class="bubble"
      class:is-on={cell.on}
      style:--tint={cell.tint ?? 'var(--accent)'}
      use:drawn={cell.key}
    />
  {/each}
</svg>
{#each cells as cell (cell.key)}
  <span class="name" class:is-on={cell.on} aria-hidden="true" use:named={cell.key}>{cell.name}</span
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

  /* In with the windows and out with them, never there before them or after: as far as
     the overview is out (Overview.svelte). */
  .cells,
  .name {
    opacity: var(--overview-open, 0);
  }

  /* A bubble: a faint wash of the space's colour inside, a soft line at its edge. */
  .bubble {
    fill: color-mix(in srgb, var(--tint) 7%, transparent);
    stroke: color-mix(in srgb, var(--tint) 45%, transparent);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }

  .bubble.is-on {
    fill: color-mix(in srgb, var(--tint) 11%, transparent);
    stroke: color-mix(in srgb, var(--tint) 70%, transparent);
  }

  /* A space's name, over the top of its bubble, at the overview's own size for it
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
