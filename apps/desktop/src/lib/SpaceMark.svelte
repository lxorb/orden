<script lang="ts">
  /** What goes in the badge in front of a space's name: the icon it was given, or
   *  the first letter of what it is called wherever that icon cannot be drawn - it
   *  was never chosen, its set has not arrived, or no set this build has ever heard
   *  of holds the name it was given.
   *
   *  Three surfaces ask the same question - the switcher's rows, the Share sheet's
   *  head and the Publish sheet's - so it is asked once here. What it sits in is
   *  the caller's `.nib-badge`, which is where the size, the corner and the colour
   *  of a badge are decided; see base.css in the themes package.
   *
   *  Which of the three kinds of icon it is, and which set has to be fetched to
   *  draw it, is Icon.svelte's business: an emoji, a stroke this app dresses in the
   *  space's own tint, or somebody else's finished drawing all come out at one
   *  optical size, and none of the three callers has to know that sets exist. What
   *  is here is only which icon a space wears and the letter it falls back to. */
  import Icon from './Icon.svelte'
  import { iconLibrary } from './icon-library.svelte'
  import { initial, readIcon } from './icons'
  import { workspace } from './workspace.svelte'

  const {
    id,
    name,
  }: {
    /** The space, as the account numbers it. Null for a folder no account has a
     *  copy of, which wears its letter. */
    id: string | null
    name: string
  } = $props()

  /** What the space wears, read the way every row in the file list reads it: any
   *  of the three sets, and any spelling a value can be written in. A space kept
   *  the library's own key before there was one format for all of them, and
   *  `readIcon` still answers for those. */
  const chosen = $derived(id ? readIcon(workspace.iconFor(id)) : null)
  const tint = $derived(id ? workspace.tintFor(id) : null)

  /** Whether anything will actually be drawn. Asking whether an icon was chosen is
   *  not the same question: a space keeps whatever name it was given, and a name no
   *  set holds - one a newer nib writes, one somebody typed, one out of a set this
   *  build leaves out - draws nothing at all. That was a badge with an empty square
   *  in it, which is what `shapeFor` in icons.ts says must never happen: three cases
   *  look the same to a reader and all three wear the space's letter. */
  const drawn = $derived(iconLibrary.drawing(chosen) !== null)
</script>

<!-- The box Icon.svelte fills, and the size an emoji in it is set at: an emoji is
     type, and a glyph has no width of its own to be stretched.

     On the page even while it draws nothing, and only taken out of the layout: asking
     for the set an icon needs is Icon.svelte's own job, and a component that is never
     mounted never asks - which would leave a space whose set is still on its way
     wearing its letter for good rather than for a second. -->
{#if chosen}
  <span class="glyph" class:away={!drawn}><Icon icon={chosen} {tint} /></span>
{/if}

<!-- The letter, for all three of those cases and for a space that chose nothing at
     all. A square with a letter in it is a space; an empty square is a bug. -->
{#if !drawn}
  {initial(name)}
{/if}

<style>
  .glyph {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    stroke: currentColor;
    stroke-width: 1.7;
  }

  /* Out of the badge's grid while there is nothing in it, so the letter beside it is
     the one thing in the cell and sits where a letter sits. Still mounted; see
     above. */
  .glyph.away {
    display: none;
  }
</style>
