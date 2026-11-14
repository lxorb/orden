<script lang="ts">
  const {
    box,
    unit,
    rise,
    reach,
    pulling,
  }: {
    box: { x: number; y: number; width: number; height: number }
    unit: number
    rise: number
    reach: number
    pulling: boolean
  } = $props()

  const BAND = 88

  const part = $derived(reach > 0 ? Math.min(1, rise / reach) : 0)
  const ready = $derived(rise >= reach && reach > 0)

  const words = $derived(ready ? 'Release to add a page' : 'Pull to add a page')
</script>

<div
  class="slot"
  class:pulling
  class:ready
  style:left="{box.x}px"
  style:top="{box.y}px"
  style:width="{box.width}px"
  style:height="{box.height}px"
  style:--unit={unit}
  style:--part={part}
  style:--band="{Math.min(BAND * unit, box.height)}px"
  aria-hidden="true"
>
  <div class="mark">
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    <span>{words}</span>
  </div>
</div>

<style>
  .slot {
    position: absolute;
    border: calc(1px * var(--unit)) dashed var(--line-strong);
    border-radius: calc(3px * var(--unit));
    background: color-mix(in srgb, var(--surface) calc(var(--part) * 100%), transparent);
    opacity: calc(0.45 + 0.55 * var(--part));
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }

  .slot.ready {
    border-style: solid;
    border-color: var(--accent);
    background: var(--surface);
    opacity: 1;
  }

  .mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(6px * var(--unit));
    height: var(--band);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: calc(12px * var(--unit));
    line-height: 1.2;
    text-align: center;
    user-select: none;
    -webkit-user-select: none;
  }

  .slot.ready .mark {
    color: var(--accent);
  }

  .mark span {
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .slot.pulling .mark span {
    opacity: 1;
  }

  .mark svg {
    width: calc(20px * var(--unit));
    height: calc(20px * var(--unit));
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
    scale: calc(0.62 + 0.38 * var(--part));
    transition: scale var(--dur-fast) var(--ease-out);
  }

  .slot.ready .mark svg {
    scale: 1;
    transition: scale var(--dur-base) var(--ease-spring);
  }
</style>
