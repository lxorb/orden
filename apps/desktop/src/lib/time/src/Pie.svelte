<script lang="ts">
  import { Mascot } from '../../mascot/src/api'
  import { length, nameOf, tintOf } from './look'
  import type { Slice } from './schedule'

  const {
    slices,
    ms,
    tracked = null,
    lit = null,
    onlight = () => undefined,
    onpin = () => undefined,
  }: {
    slices: readonly Slice[]
    ms: number
    tracked?: number | null
    lit?: string | null
    onlight?: (key: string | null) => void
    onpin?: (key: string | null) => void
  } = $props()
  const keyOf = (slice: Slice) => slice.activity ?? ''
  const shown = $derived(lit === null ? null : (slices.find((one) => keyOf(one) === lit) ?? null))
  const GAP = 0.45
  const arcs = $derived.by(() => {
    let before = 0
    const gap = slices.length > 1 ? GAP : 0
    return slices.map((one) => {
      const share = ms > 0 ? (one.ms / ms) * 100 : 0
      const drawn = Math.max(0, share - gap)
      const arc = { slice: one, drawn, offset: 25 - before }
      before += share
      return arc
    })
  })
</script>

<figure class="pie" data-time-pie>
  <svg viewBox="0 0 42 42" role="img" aria-label="Time by activity">
    <circle class="ground" cx="21" cy="21" r="15.915" />
    {#each arcs as arc (arc.slice.activity)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <circle
        cx="21"
        cy="21"
        r="15.915"
        class:unset={arc.slice.activity === null}
        class:lit={lit === keyOf(arc.slice)}
        class:dim={lit !== null && lit !== keyOf(arc.slice)}
        data-arc={keyOf(arc.slice)}
        onmouseenter={() => onlight(keyOf(arc.slice))}
        onmouseleave={() => onlight(null)}
        onclick={() => onpin(keyOf(arc.slice))}
        stroke={arc.slice.activity === null ? 'var(--muted)' : tintOf(arc.slice.activity)}
        stroke-dasharray="{arc.drawn} {100 - arc.drawn}"
        stroke-dashoffset={arc.offset}
      >
        <title>{nameOf(arc.slice.activity, 'Not set')}, {length(arc.slice.ms)}</title>
      </circle>
    {/each}
  </svg>
  <figcaption>
    {#if shown}
      <strong>{length(shown.ms)}</strong>
      <span class="name" dir="auto">{nameOf(shown.activity, 'Not set')}</span>
    {:else if ms > 0}
      <strong>{length(ms)}</strong>
      <span>{tracked === null ? 'tracked' : `${length(tracked)} tracked`}</span>
    {:else}
      <Mascot mood="sleepy" size={28} />
      <span>Nothing tracked</span>
    {/if}
  </figcaption>
</figure>

<style>
  .pie {
    position: relative;
    width: 168px;
    height: 168px;
    margin: 0 auto;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  circle {
    fill: none;
    stroke-width: 4.5;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      stroke-width var(--dur-fast) var(--ease-out);
  }
  circle.lit {
    stroke-width: 5.5;
  }
  circle.dim {
    opacity: 0.3;
  }
  .ground {
    stroke: var(--surface-2);
  }
  .unset {
    opacity: 0.55;
  }
  figcaption {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .name {
    max-width: 7.5rem;
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    color: var(--text-strong);
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
</style>
