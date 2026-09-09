<script lang="ts">
  /** The mark in front of a row in the file list: one small icon per kind of
   *  file, and the folder the row is if it is one.
   *
   *  Which icon is `file-mark.ts`; this is how big it is drawn and how heavy. All
   *  of them come off Lucide's 24 unit grid, which is drawn for 24px and read
   *  here at half that, so the weight is set here rather than taken: a stroke
   *  scaled with the box would come out at half a pixel and the whole list would
   *  read as grey. Just under a pixel at either size instead, which is a hairline
   *  that still has a shape, and the same weight on both so a phone and a desktop
   *  draw one family.
   *
   *  A folder wears the same box as the files under it, so every name in the list
   *  starts at the same place whatever the row holds. */
  import { MARKS, type Mark } from './file-mark'

  const { mark }: { mark: Mark } = $props()

  const icon = $derived(MARKS[mark])
</script>

<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs] (JSON.stringify(attrs))}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  /* Quieter than the name beside it: the mark is there to be glanced at, not
     read. */
  .mark {
    width: 13px;
    height: 13px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.85;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* A finger's list draws the same icon larger, at the size every other mark in
     the app is drawn on a touch screen, and with the stroke brought back down by
     as much as the box went up. */
  :global([data-touch]) .mark {
    width: var(--touch-mark);
    height: var(--touch-mark);
    stroke-width: 1.6;
  }
</style>
