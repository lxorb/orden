<script lang="ts">
  /** What goes in the badge in front of a space's name: the icon it was given, or
   *  the first letter of what it is called until it has one.
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
</script>

{#if chosen}
  <!-- The box Icon.svelte fills, and the size an emoji in it is set at: an emoji
       is type, and a glyph has no width of its own to be stretched. -->
  <span class="glyph"><Icon icon={chosen} {tint} /></span>
{:else}
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
</style>
