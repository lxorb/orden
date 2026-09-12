<script lang="ts">
  /** The mark that says a row has something under it, and turns when it is let out.
   *
   *  One drawing, two lists: the file tree, where a note holding notes wears one at the
   *  far end of its row, and the tag tree, where a tag with tags under it wears one in
   *  front. Two copies of it were two chevrons that would have drifted - one at 1.5
   *  weight and one at 1.6, one turning in `--dur-base` and one instantly - and a
   *  disclosure that is not the same shape in two lists reads as two different
   *  gestures.
   *
   *  The box is the caller's, the way it is for Icon.svelte: the tag tree draws it at
   *  `--icon-md` in front of a name, the file tree at `--icon-sm` after one. What is
   *  here is the shape, the weight and the turn.
   *
   *  Never a control on its own. Both lists put it inside something already clickable -
   *  a button of its own beside the row, or the row itself - because a button cannot
   *  hold a button, and neither can say what it is for; the row says that. */
  const { open }: { open: boolean } = $props()
</script>

<svg class="turn" class:open viewBox="0 0 8 8" aria-hidden="true"><path d="M2 1l3 3-3 3" /></svg>

<style>
  .turn {
    width: 100%;
    height: 100%;
    flex: none;
    transform: scaleX(var(--dir));
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-base) var(--ease-out);
  }

  /* Pointing at what it holds shut, and turned to point down at what it has let out.
     Turned rather than swapped for a second drawing, so the two states are one mark
     moving; see motion.ts. */
  .turn.open {
    transform: scaleX(var(--dir)) rotate(90deg);
  }
</style>
