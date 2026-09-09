<script lang="ts">
  /** One chosen icon, drawn - whichever of the three sets it came from.
   *
   *  There are three honest ways to put a picture on screen and this is the one
   *  place that knows all three: an emoji is a character the platform's own colour
   *  font draws, a Lucide icon is a stroke this app dresses itself, and a drawing
   *  out of a coloured set is somebody else's finished picture that has to be left
   *  exactly as it was. Everything that shows an icon - the file list, the rail, the
   *  picker's own grid - draws this, so all three come out at the same optical size
   *  and none of those places has to know that sets exist.
   *
   *  The box is the caller's. This fills whatever it is given, so a mark in a row is
   *  `--icon-md` and a square in the rail is `--icon-rail` without either size being
   *  repeated here. The one thing a caller owes: `font-size` on that box as well as
   *  its width and height, because an emoji is type and a glyph has no width of its
   *  own to be stretched.
   *
   *  The set is asked for from here as well, for the same reason: a row that wears a
   *  coloured icon is the only thing that knows the coloured set is wanted, and
   *  asking is free after the first time. See icon-library.svelte.ts. */
  import { accentColour } from './accents'
  import { iconLibrary } from './icon-library.svelte'
  import { type IconNode, readTint, type WrittenIcon } from './icons'
  import { theme } from './theme.svelte'

  const {
    icon,
    tint = null,
    fallback = null,
  }: {
    /** What was chosen, or null for something that chose nothing. */
    icon: WrittenIcon | null
    /** An accent id, for a stroked icon only: an emoji and a coloured drawing have
     *  their own colours, and tinting either would be painting over the picture. */
    tint?: string | null
    /** What to stroke where nothing was chosen, or where the set that would draw it
     *  has not arrived: the kind's own mark, the app's own glyph. Null draws
     *  nothing, which is what a caller with its own fallback markup wants. */
    fallback?: IconNode | null
  } = $props()

  const drawing = $derived(iconLibrary.drawing(icon))
  const wanted = $derived(iconLibrary.setFor(icon))

  // Only worth fetching a set once something on screen actually wears one of its
  // icons; the holder does it once for the app, so a hundred rows are one fetch.
  $effect(() => {
    if (wanted !== null) iconLibrary.load(wanted)
  })

  /** The stroked shape to draw: what was chosen, or the fallback. */
  const stroked = $derived(drawing?.kind === 'stroked' ? drawing.icon : (fallback ?? null))

  /** The tint as a colour this scheme can read. Read rather than taken: a note is
   *  somebody's file and may say `icon-color: chartreuse`, and a name no palette holds
   *  is no colour rather than the first accent in the list.
   *
   *  Only where a stroke is actually being drawn, and never over a fallback: a plain
   *  page in violet would say the chosen icon had arrived when it had not. */
  const painted = $derived(readTint(tint))
  const colour = $derived(
    painted && drawing?.kind === 'stroked' ? accentColour(painted, theme.current) : null,
  )
</script>

{#if drawing?.kind === 'emoji'}
  <!-- A character rather than a drawing, so it is set in the same box at the same
       size instead of being stroked, and a shade smaller: an emoji's glyph fills its
       em box to the edges while a stroked icon has air around it, so the two only
       read as one size when the emoji is reduced. -->
  <span class="glyph emoji">{drawing.text}</span>
{:else if drawing?.kind === 'drawn'}
  <!-- Somebody else's drawing, as it was drawn: its own box, its own colours, no
       stroke of ours over it. The markup is a set this app ships, read out of its
       own package at build time - never anything a note or a person typed. -->
  <svg class="glyph drawn" viewBox={drawing.box} aria-hidden="true">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- a shipped icon set, not content -->
    {@html drawing.body}
  </svg>
{:else if stroked}
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style:color={colour}>
    {#each stroked as [tag, attrs] (JSON.stringify(attrs))}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/if}

<style>
  /* The caller's box, filled. One rule for all three kinds, so a row cannot end up
     with an emoji one size and a stroke another.

     The colour and the weight are the caller's too, and deliberately not set here:
     `stroke` is an inherited SVG property, so a list that says the row it is on
     wears the accent says it once, on the box, and the glyph takes it. What is here
     is only what would be wrong everywhere else - no fill on a stroked icon, and
     round joins, which is how Lucide is drawn. */
  .glyph {
    width: 100%;
    height: 100%;
    flex: none;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A finished drawing paints itself: the fills are in the file, and a stroke of
     ours over them would outline every shape in the picture. */
  .drawn {
    fill: currentColor;
    stroke: none;
  }

  .emoji {
    display: grid;
    place-items: center;
    /* Against the box rather than the text, so one number covers a 16px mark and a
       28px square in the rail. 0.88 is where a face sits level with the cap height
       of the name beside it. */
    font-size: 0.88em;
    line-height: 1;
  }
</style>
