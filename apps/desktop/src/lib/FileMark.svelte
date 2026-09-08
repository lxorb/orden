<script module lang="ts">
  /** The mark in front of a file's name: one small drawing per kind of file.
   *
   *  One family, so a list of files reads as a list rather than as a row of
   *  unrelated pictures. Three of them are the same sheet: plain for a file
   *  nothing here can read, with two lines of writing for a note, with its
   *  corner turned for a PDF. The other two are square: two joined cards for a
   *  canvas, a framed range for a picture.
   *
   *  Drawn in the slot the folder chevrons sit in, at the stroke the chevron
   *  carries, so a row keeps its height and every name in the list starts at the
   *  same place whatever is in front of it.
   */
  import type { FileMark } from './file-mark'

  /** A drawing: the grid it is set out on, and the strokes it is made of. The
   *  sheets are taller than they are wide; the square pair is drawn on a square
   *  grid and fitted into the same slot, which is what keeps the two families at
   *  one optical size. */
  interface Drawing {
    box: string
    strokes: string[]
  }

  const SHEET = 'M1.2 0.8h6.6v9.4H1.2z'

  const DRAWINGS: Record<FileMark, Drawing> = {
    // Two lines of writing on a sheet: something with words in it.
    note: { box: '0 0 9 11', strokes: [SHEET, 'M3 4.4h3M3 6.6h3'] },
    // A sheet with its corner turned, the way a paper is marked everywhere.
    pdf: { box: '0 0 9 11', strokes: ['M1.2 0.8h3.6l3 3v6.4H1.2z', 'M4.8 0.8v3h3'] },
    // Two cards joined: a plane with things on it.
    canvas: {
      box: '0 0 11 11',
      strokes: ['M0.8 1.4h4v3h-4zM6.2 6.6h4v3h-4z', 'M4.8 2.9h.9v5.2h.5'],
    },
    // A frame with a range of hills in it.
    picture: {
      box: '0 0 11 11',
      strokes: ['M0.9 1.9h9.2v7.2H0.9z', 'M0.9 8.3L3.5 5.7l1.8 1.8 1.6-1.6 2.3 2.3'],
    },
    // A sheet and nothing on it: a file this build has nothing to say about.
    file: { box: '0 0 9 11', strokes: [SHEET] },
  }
</script>

<script lang="ts">
  const { mark }: { mark: FileMark } = $props()

  const drawing = $derived(DRAWINGS[mark])
</script>

<svg class="mark" viewBox={drawing.box} aria-hidden="true">
  {#each drawing.strokes as stroke (stroke)}
    <path d={stroke} />
  {/each}
</svg>

<style>
  /* Quieter than the name beside it: the mark is there to be glanced at, not
     read. */
  .mark {
    width: 9px;
    height: 11px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* The same drawing at a finger's list size. The slot keeps the 9 by 11 the
     sheets are drawn on, so the mark grows without being stretched, and the
     stroke comes back down by as much as the box went up. */
  :global([data-touch]) .mark {
    width: var(--touch-mark);
    height: calc(var(--touch-mark) * 11 / 9);
    stroke-width: 0.8;
  }
</style>
