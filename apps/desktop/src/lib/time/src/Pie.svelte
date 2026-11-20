<script lang="ts">
  import { length, nameOf, tintOf } from './look'
  import type { Slice } from './schedule'

  const { slices, ms }: { slices: readonly Slice[]; ms: number } = $props()
  const arcs = $derived.by(() => {
    let before = 0
    return slices.map((one) => {
      const share = ms > 0 ? (one.ms / ms) * 100 : 0
      const arc = { slice: one, share, offset: 25 - before }
      before += share
      return arc
    })
  })
</script>

<figure class="pie" data-time-pie>
  <svg viewBox="0 0 42 42" role="img" aria-label="The day by activity">
    <circle class="ground" cx="21" cy="21" r="15.915" />
    {#each arcs as arc (arc.slice.activity)}
      <circle
        cx="21"
        cy="21"
        r="15.915"
        stroke={arc.slice.activity === null ? 'var(--line-strong)' : tintOf(arc.slice.activity)}
        stroke-dasharray="{Math.max(0, arc.share - (arcs.length > 1 ? 0.6 : 0))} {100 -
          Math.max(0, arc.share - (arcs.length > 1 ? 0.6 : 0))}"
        stroke-dashoffset={arc.offset}
      >
        <title>{nameOf(arc.slice.activity, 'No activity')}, {length(arc.slice.ms)}</title>
      </circle>
    {/each}
  </svg>
  <figcaption>{length(ms)}</figcaption>
</figure>

<style>
  .pie {
    position: relative;
    width: 9.5rem;
    margin: 0 auto;
  }
  svg {
    display: block;
    width: 100%;
    rotate: 0deg;
  }
  circle {
    fill: none;
    stroke-width: 5.5;
  }
  .ground {
    stroke: var(--surface-2);
  }
  figcaption {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-strong);
    font-size: var(--text-base, 1rem);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }
</style>
