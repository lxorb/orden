<script lang="ts">
  import Tabs from './Tabs.svelte'
  import TopStrips from './TopStrips.svelte'
  import { type Frame, tracks } from './workspace/pane-tree'
  import { workspace } from './workspace.svelte'

  const {
    frame,
    start = true,
    end = true,
  }: {
    frame: Frame
    start?: boolean
    end?: boolean
  } = $props()

  const split = $derived(frame.kind === 'split' ? frame : null)
</script>

{#if split}
  <div
    class="split"
    class:sliding={workspace.panes.sliding === split.id}
    style:grid-template-columns={tracks(split)}
  >
    <TopStrips frame={split.sides[0]} {start} end={false} />
    <span></span>
    <TopStrips frame={split.sides[1]} start={false} {end} />
  </div>
{:else}
  <div class="slot" class:start class:finish={end} data-top-strip={frame.id}>
    <Tabs paneId={frame.id} caption />
  </div>
{/if}

<style>
  .split {
    display: grid;
    min-width: 0;
    transition: grid-template-columns var(--dur-base) var(--ease-out);
  }

  .split.sliding {
    transition: none;
  }

  .slot {
    display: flex;
    align-items: stretch;
    min-width: 0;
    overflow: clip;
  }

  .slot.start {
    padding-inline-start: var(--strip-lead, 0px);
  }

  .slot.finish {
    padding-inline-end: var(--strip-end, 0px);
  }

  .slot > :global(.strip) {
    pointer-events: auto;
  }
</style>
