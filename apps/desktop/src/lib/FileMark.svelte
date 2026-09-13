<script lang="ts">
  /** The mark in front of a row in the file list: one small icon per kind of file
   *  and, where the file chose one of its own, that instead.
   *
   *  Which icon a kind wears is `file-mark.ts`; how any icon is drawn is
   *  `Icon.svelte`. What is here is how big it is drawn and how heavy. All of the
   *  marks come off Lucide's 24 unit grid, which is drawn for 24px and read here at
   *  half that, so the weight is set rather than taken: a stroke scaled with the box
   *  would come out at half a pixel and the whole list would read as grey. Just under
   *  a pixel at either size instead, which is a hairline that still has a shape, and
   *  the same weight on both so a phone and a desktop draw one family.
   *
   *  Every row wears the same box, so every name in the list starts at the same
   *  place whatever the row holds.
   *
   *  A note that says `icon:` in its front matter wears that, in the same box - and
   *  so does a canvas that says it under `nib.icon`, and a folder the space's own map
   *  names, which is how a folder out of somebody's vault wears one before it has a
   *  note to keep it in. It is read here rather than passed in, from the path the row
   *  already knows, so every list that draws a mark shows the chosen icon without
   *  knowing that anything has icons at all: the tree, the tab strip, a search
   *  result, a bookmark, the Move sheet. See chosen-icon.ts for where the value comes
   *  from and icons.ts for what it may say.
   *
   *  What a row holds is said at the far end of it and by the indentation of what
   *  follows, never by the mark: the mark says what the row is. */
  import { chosenIcon, chosenTint } from './chosen-icon'
  import { type FileMark, MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { readIcon } from './icons'

  const { mark, path }: { mark: FileMark; path?: string } = $props()

  /** What the file or folder at this path chose, or null for a row that chose
   *  nothing - and for a caller that knows a name but no path, which gets its kind's
   *  mark. */
  const chosen = $derived(path === undefined ? null : readIcon(chosenIcon(path)))
  const tint = $derived(path === undefined ? null : chosenTint(path))
</script>

<span class="mark" class:quiet={chosen === null || chosen.kind === 'lucide'}>
  <Icon icon={chosen} {tint} fallback={MARKS[mark]} />
</span>

<style>
  /* Quieter than the name beside it: the mark is there to be glanced at, not read.
     As big as the words, though - `--icon-md` is 16px against a 13.5px name and 20px
     against a 17px one, which is the proportion a file list is read at. A phone and a
     desktop take the same rule; the token is what differs, and it differs once, in
     the themes package.

     `font-size` as well as the box, because an emoji is type: see Icon.svelte. */
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  /* A stroke is held back; a picture is not. Fading an emoji or a coloured drawing
     reads as a mistake rather than as a quiet mark - it is already a picture in its
     own colours, and somebody chose it. On the box rather than on the glyph, so a
     list can still say the row it is on wears the accent at full strength. */
  .quiet {
    opacity: 0.8;
  }
</style>
