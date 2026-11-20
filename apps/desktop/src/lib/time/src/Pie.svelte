<script lang="ts">
  import { length, nameOf, tintOf } from './look'
  import type { Slice } from './schedule'

  const { slices, ms, tracked = null }: { slices: readonly Slice[]; ms: number; tracked?: number | null } = $props()
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
      <circle
        cx="21"
        cy="21"
        r="15.915"
        class:unset={arc.slice.activity === null}
        stroke={arc.slice.activity === null ? 'var(--muted)' : tintOf(arc.slice.activity)}
        stroke-dasharray="{arc.drawn} {100 - arc.drawn}"
        stroke-dashoffset={arc.offset}
      >
        <title>{nameOf(arc.slice.activity, 'Not set')}, {length(arc.slice.ms)}</title>
      </circle>
    {/each}
  </svg>
  <figcaption>
    {#if ms > 0}
      <strong>{length(ms)}</strong>
      <span>{tracked === null ? 'tracked' : `${length(tracked)} tracked`}</span>
    {:else}
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  strong {
    color: var(--text-strong);
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
</style>
