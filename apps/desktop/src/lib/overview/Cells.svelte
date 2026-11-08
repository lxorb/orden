<script lang="ts">
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
    inside: (key: string) => readonly Box[]
    holding: boolean
    pushed: () => { key: string; boxes: readonly Box[] } | null
  } = $props()

  interface Kept {
    bubble: Bubble
    path: SVGPathElement | null
    name: HTMLElement | null
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const kept = new Map<string, Kept>()

  function boxesOf(
    key: string,
    hand: { key: string; boxes: readonly Box[] } | null,
  ): readonly Box[] {
    const own = inside(key)
    return hand?.key === key ? [...own, ...hand.boxes] : own
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
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (a && b) apart(a.one.bubble, b.one.bubble, a.boxes, b.boxes)
      }
    }
    for (const { one } of all) {
      one.path?.setAttribute('d', one.bubble.pathOf())
      const crown = one.bubble.crown()
      if (one.name) one.name.style.translate = `${crown.x}px ${crown.y}px`
    }

    const seen = JSON.stringify(all.map(({ boxes }) => boxes))
    const moving = !still || hand !== null || seen !== last
    last = seen
    frame = moving ? requestAnimationFrame(tick) : 0
  }

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
  <span
    class="name"
    class:is-on={cell.on}
    data-space-name={cell.key}
    aria-hidden="true"
    use:named={cell.key}
    dir="auto">{cell.name}</span
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

  .cells,
  .name {
    opacity: var(--overview-open, 0);
  }

  .bubble {
    fill: color-mix(in srgb, var(--tint) 7%, transparent);
    stroke: color-mix(in srgb, var(--tint) 50%, transparent);
    stroke-width: calc(3px * var(--overview-line, 1));
    stroke-linejoin: round;
  }

  .bubble.is-on {
    fill: color-mix(in srgb, var(--tint) 11%, transparent);
    stroke: color-mix(in srgb, var(--tint) 70%, transparent);
  }

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
    scale: var(--overview-space-names);
    transform: translate(-50%, calc(-100% - var(--space-2)));
  }

  .name.is-on {
    color: var(--text-strong);
  }

  [dir='auto'] {
    text-align: -webkit-match-parent;
    text-align: match-parent;
  }
</style>
