<script module lang="ts">
  /** The mark in front of a file's name: one small drawing per kind of file.
   *
   *  One family, so a list of files reads as a list rather than as a row of
   *  unrelated pictures. Three of them are the same page: plain for a file
   *  nothing here can read, with two lines of writing for a note, with its
   *  corner turned for a PDF. The other two are wider: two joined cards for a
   *  canvas, a framed range for a picture.
   *
   *  Every corner is an arc: the page on the 1.2 the Files tab's folder turns
   *  on, the smaller shapes on less, because a list of these is glanced at and a
   *  sharp corner is what catches. The turned corner stays the PDF's alone,
   *  since it is the whole of what tells a PDF from a note at this size, and a
   *  note is a plain page with writing on it and nothing else.
   *
   *  Drawn in the slot the folder chevrons sit in, at the stroke the chevron
   *  carries, so a row keeps its height and every name in the list starts at the
   *  same place whatever is in front of it.
   */
  import type { FileMark } from './file-mark'

  /** A drawing: the grid it is set out on, and the strokes it is made of.
   *
   *  Both grids are one unit to the pixel in a pointer's tree: the pages are 9
   *  by 11 in a 9 by 11 slot, and the wider pair 9 by 9 centred in the same
   *  slot, so the family is one scale and one stroke rather than a shrunk half
   *  and a full one. The slot is an odd number of pixels tall inside an even
   *  row, which puts its top edge half a pixel down the row: a horizontal edge
   *  covers one whole pixel when its y is a whole unit, and a vertical edge when
   *  its x is a half unit. Every number below is one or the other, which is why
   *  none of these read as blurred at the size they are actually drawn. */
  interface Drawing {
    box: string
    strokes: string[]
  }

  /** A page: 6 by 9 in the middle of the slot, corners arced by 1.2. */
  const PAGE =
    'M2.7 1h3.6a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2V2.2a1.2 1.2 0 0 1 1.2-1.2z'

  const DRAWINGS: Record<FileMark, Drawing> = {
    // Two lines of writing on a page: something with words in it. Set so the
    // page keeps two clear pixels above them, between them and below them.
    note: { box: '0 0 9 11', strokes: [PAGE, 'M3.2 4h2.6M3.2 7h2.6'] },
    // A page with its corner turned, the way a paper is marked everywhere. The
    // turn is arced as well, so it reads as folded rather than as cut off.
    pdf: {
      box: '0 0 9 11',
      strokes: [
        'M2.7 1h1.8l3 3v4.8a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2V2.2a1.2 1.2 0 0 1 1.2-1.2z',
        'M4.5 1v1.8a1.2 1.2 0 0 0 1.2 1.2h1.8',
      ],
    },
    // Two cards joined: a plane with things on it. The join is one curve rather
    // than the elbow it was, which is two right angles out of a drawing whose
    // cards are five pixels across.
    canvas: {
      box: '0 0 9 9',
      strokes: [
        'M1 0h3a0.5 0.5 0 0 1 0.5 0.5v2a0.5 0.5 0 0 1-0.5 0.5H1a0.5 0.5 0 0 1-0.5-0.5v-2a0.5 0.5 0 0 1 0.5-0.5zM5 6h3a0.5 0.5 0 0 1 0.5 0.5v2a0.5 0.5 0 0 1-0.5 0.5H5a0.5 0.5 0 0 1-0.5-0.5v-2a0.5 0.5 0 0 1 0.5-0.5z',
        'M3.5 3C3.5 4.2 5.5 4.8 5.5 6',
      ],
    },
    // A frame with a range of hills in it, shouldered at the peaks so the one
    // drawing here made of slopes is not the one with points on it.
    picture: {
      box: '0 0 9 9',
      strokes: [
        'M1.5 1h6a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H1.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z',
        'M0.5 6.6L2.5 4.1q0.25-0.25 0.5 0L4.4 5.5q0.25 0.25 0.5 0L6.1 4.3q0.25-0.25 0.5 0L8.5 6.2',
      ],
    },
    // A page and nothing on it: a file this build has nothing to say about.
    file: { box: '0 0 9 11', strokes: [PAGE] },
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
     read. Round ends as well as round corners, so a line of writing and a hill
     stop the way a corner turns. */
  .mark {
    width: 9px;
    height: 11px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* The same drawing at a finger's list size. The slot keeps the 9 by 11 the
     pages are drawn on, so the mark grows without being stretched, and the
     stroke comes back down by as much as the box went up. */
  :global([data-touch]) .mark {
    width: var(--touch-mark);
    height: calc(var(--touch-mark) * 11 / 9);
    stroke-width: 0.8;
  }
</style>
