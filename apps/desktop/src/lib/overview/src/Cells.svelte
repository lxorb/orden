<script lang="ts">
  import { onDestroy } from 'svelte'
  import { dur, stillness } from '../../platform/src/api'
  import { apart, Bubble, SWAY_MS, wobbleOf } from './bubble'
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
    holder: SVGSVGElement | null
    path: SVGPathElement | null
    name: HTMLElement | null
    sway: Animation | null
    size: number
    origin: string
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const kept = new Map<string, Kept>()
  function boxesOf(key: string, hand: { key: string; boxes: readonly Box[] } | null): readonly Box[] {
    const own = inside(key)
    return hand?.key === key ? [...own, ...hand.boxes] : own
  }
  function keptOf(key: string): Kept {
    const known = kept.get(key)
    if (known) return known
    const made: Kept = {
      bubble: new Bubble(boxesOf(key, pushed())),
      holder: null,
      path: null,
      name: null,
      sway: null,
      size: 0,
      origin: '',
    }
    kept.set(key, made)
    return made
  }
  function drawn(node: SVGSVGElement, key: string) {
    const one = keptOf(key)
    one.holder = node
    one.path = node.querySelector('path')
    return {
      destroy() {
        one.sway?.cancel()
        kept.delete(key)
      },
    }
  }
  function seedOf(key: string): number {
    let hash = 7
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 9973
    return hash / 9973
  }
  function centre(one: Kept) {
    const { x, y } = one.bubble.middle()
    const origin = `${Math.round(x)}px ${Math.round(y)}px`
    if (one.holder && origin !== one.origin) one.holder.style.transformOrigin = one.origin = origin
  }
  function sway(key: string, one: Kept) {
    const holder = one.holder
    const size = one.bubble.size()
    if (!holder || stillness() || typeof holder.animate !== 'function') return
    if (one.sway && Math.abs(size - one.size) <= one.size / 4) {
      one.sway.play()
      return
    }
    const seed = seedOf(key)
    const at = one.sway?.currentTime ?? seed * SWAY_MS
    one.sway?.cancel()
    one.size = size
    one.sway = holder.animate(wobbleOf(size, seed), { duration: dur(SWAY_MS), iterations: Number.POSITIVE_INFINITY })
    one.sway.currentTime = at
  }
  const REST_MS = 700
  let hushed = true
  let rest = 0
  function hush() {
    if (!hushed) for (const one of kept.values()) one.sway?.pause()
    hushed = true
    clearTimeout(rest)
    rest = window.setTimeout(stir, REST_MS)
  }
  function stir() {
    rest = 0
    if (frame) return
    hushed = false
    for (const [key, one] of kept) sway(key, one)
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
  let last = ''
  function tick() {
    const hand = pushed()
    const all = cells.map((cell) => ({
      cell,
      one: keptOf(cell.key),
      boxes: boxesOf(cell.key, hand),
    }))
    for (const { one, boxes } of all) one.bubble.step(boxes)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (a && b) apart(a.one.bubble, b.one.bubble, a.boxes, b.boxes)
      }
    }
    for (const { one } of all) {
      one.path?.setAttribute('d', one.bubble.pathOf())
      centre(one)
      const crown = one.bubble.crown()
      if (one.name) one.name.style.translate = `${crown.x}px ${crown.y}px`
    }
    const seen = JSON.stringify(all.map(({ boxes }) => boxes))
    const moving = hand !== null || seen !== last
    last = seen
    frame = moving ? requestAnimationFrame(tick) : 0
    hush()
  }
  export function wake() {
    if (frame || (!cells.length && !holding)) return
    frame = requestAnimationFrame(tick)
  }
  $effect(() => {
    if (cells.length || holding) wake()
  })
  onDestroy(() => {
    cancelAnimationFrame(frame)
    clearTimeout(rest)
  })
</script>

<svelte:window onpointermovecapture={hush} onpointerdowncapture={hush} onkeydowncapture={hush} onwheelcapture={hush} />

{#each cells as cell (cell.key)}
  <svg class="cells" width="1" height="1" aria-hidden="true" use:drawn={cell.key}>
    <path class="bubble" class:is-on={cell.on} style:--tint={cell.tint ?? 'var(--accent)'} />
  </svg>
{/each}
{#each cells as cell (cell.key)}
  <span class="name" class:is-on={cell.on} data-space-name={cell.key} aria-hidden="true" use:named={cell.key} dir="auto"
    >{cell.name}</span
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
