<script lang="ts">
  /** The scratchpad card's column. Its width slides like a sidebar's (Sidebar.svelte's
   *  `.column`) with the card held at its own width inside, and it opens on the frame the
   *  right side closes on, so the note eases between the two (workspace/panels.ts). */
  import { untrack } from 'svelte'
  import { dur } from '../motion'
  import { startup } from '../startup.svelte'
  import { scratchpadCard } from '../surfaces.svelte'
  import { shown } from './is.svelte'

  let column = $state<HTMLElement>()
  /** Built from the ask until it has slid away. */
  let kept = $state(untrack(() => shown.on))
  /** Laid out shut to open from; one the launch put back is open already. */
  let entered = $state(untrack(() => shown.on && !startup.reached('index')))
  const narrow = $derived(!shown.on || !entered)
  let moving = $state(false)

  $effect(() => {
    if (shown.on) kept = true
    else entered = false
  })

  // Shut, measured and opened before a paint, so the width slides from nothing.
  $effect(() => {
    if (!shown.on || entered || !column) return
    column.getBoundingClientRect()
    entered = true
  })

  let wasNarrow = untrack(() => narrow)
  $effect.pre(() => {
    if (narrow === wasNarrow) return
    wasNarrow = narrow
    moving = dur(1) > 0
    if (!moving && !shown.on) kept = false
  })

  function slid(event: TransitionEvent) {
    if (event.target !== event.currentTarget || event.propertyName !== 'width') return
    moving = false
    if (!shown.on) kept = false
  }
</script>

{#if kept}
  <div
    bind:this={column}
    class="pad"
    class:shut={!shown.on}
    class:coming={narrow && shown.on}
    class:moving
    data-scratchpad
    style:--pad-width="{shown.width}px"
    ontransitionend={slid}
    ontransitioncancel={slid}
  >
    {#await scratchpadCard() then Card}<Card />{/await}
  </div>
{/if}

<style>
  .pad {
    flex: none;
    display: flex;
    justify-content: flex-end;
    width: var(--pad-width);
    transition:
      width var(--dur-base) var(--ease-out),
      visibility 0s;
  }

  .coming,
  .shut {
    width: 0;
  }

  /* The one note on a phone and a tablet, so all of where the note is; see
     ScratchpadCard.svelte. */
  :global(html:not([data-device='desktop'])) .pad:not(.coming, .shut) {
    width: 100%;
  }

  .shut {
    visibility: hidden;
    transition:
      width var(--dur-base) var(--ease-out),
      visibility 0s var(--dur-base);
  }

  .moving,
  .coming,
  .shut {
    overflow: clip;
  }
</style>
