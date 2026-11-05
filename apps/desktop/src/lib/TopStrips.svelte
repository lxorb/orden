<script lang="ts">
  /** The tab strips in the window's one top row (#1037): one over each pane that touches
   *  the bar, as wide as that pane and where it is, so a split's strips are the bar
   *  rather than a second row under an empty one.
   *
   *  The same grid as PaneTree.svelte, track for track - the shares from `tracks`, the
   *  room between two cards, the same easing and none while the divider is held - so a
   *  strip lines up with its pane by construction, with nothing measured. Laid out over
   *  `topRow`, which keeps of a split one above the other only its upper side: a pane
   *  under another one carries its strip on its own card (Pane.svelte).
   *
   *  The strips at the row's two ends leave room for what is the window's rather than any
   *  pane's - the search and the tab overview at one end, the window's buttons at the
   *  other - by how far those reach over them, which the bar says (`--strip-lead` and
   *  `--strip-end`, Titlebar.svelte). Everything here but the strips lets the pointer
   *  through to the bar under it, which is what the window is dragged by. */

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
    /** Whether this part of the row runs to the bar's start, and to its end. */
    start?: boolean
    end?: boolean
  } = $props()

  /** Read here rather than narrowed in the markup, as PaneTree.svelte does. */
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

  /* Cut at its own ends, so the line one strip draws out to the bar's ends never runs
     under the next strip's open tab. */
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
