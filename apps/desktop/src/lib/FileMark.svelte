<script lang="ts">
  /** The mark in front of a row in the file list: one small icon per kind of
   *  file, the folder the row is if it is one, and, where the file chose one of
   *  its own, that instead.
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
   *  starts at the same place whatever the row holds.
   *
   *  A note that says `icon:` in its front matter wears that, in the same box at
   *  the same weight - and so does a canvas that says it under `nib.icon`, and a
   *  folder the space's own map names. It is read here rather than passed in, from
   *  the path the row already knows, so every list that draws a mark shows the
   *  chosen icon without knowing that anything has icons at all: the tree, the tab
   *  strip, a search result, a bookmark, the Move sheet. See chosen-icon.ts for
   *  where the value comes from and icons.ts for what it may say.
   *
   *  A folder wearing one shows it whether it is open or shut, and the row still
   *  says which it is: the chevron is the caret in `aria-expanded` and the
   *  indentation of what follows. Two icons for one folder would be two folders. */
  import { chosenIcon } from './chosen-icon'
  import { MARKS, type Mark } from './file-mark'
  import { iconLibrary } from './icon-library.svelte'
  import { readIcon } from './icons'

  const { mark, path }: { mark: Mark; path?: string } = $props()

  /** What the file or folder at this path chose, or null for a row that chose
   *  nothing - and for a caller that knows a name but no path, which gets its
   *  kind's mark. */
  const chosen = $derived(path === undefined ? null : readIcon(chosenIcon(path)))

  // Only worth fetching the set once something on screen actually wears one of
  // its icons; see icon-library.svelte.ts, which does it once for the app.
  $effect(() => {
    if (chosen?.kind === 'lucide') iconLibrary.load()
  })

  /** The chosen drawing, or the kind's own where there is none - which is also
   *  what a row shows for the moment before the set has arrived, and for a name
   *  no icon in it answers to. */
  const icon = $derived(
    (chosen?.kind === 'lucide' ? iconLibrary.shape(chosen.name) : null) ?? MARKS[mark],
  )
</script>

{#if chosen?.kind === 'emoji'}
  <!-- An emoji is a character rather than a drawing, so it is set in the same box
       at the same size instead of being stroked. Nothing written in a note that
       nib itself writes: it is what a vault carries in from Obsidian's Iconize,
       and a note that already wore one goes on wearing it here. -->
  <span class="mark emoji">{chosen.text}</span>
{:else}
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    {#each icon as [tag, attrs] (JSON.stringify(attrs))}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/if}

<style>
  /* Quieter than the name beside it: the mark is there to be glanced at, not
     read. As big as the words, though - `--icon-md` is 16px against a 13.5px
     name and 20px against a 17px one, which is the proportion a file list is
     read at. A phone and a desktop take the same rule; the token is what
     differs, and it differs once, in the themes package. */
  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }

  /* The same box, filled by a glyph instead of a stroke. Full strength, because
     an emoji is already a picture in its own colours and a faded one reads as a
     mistake rather than as a quiet mark. */
  .emoji {
    display: grid;
    place-items: center;
    font-size: var(--icon-md);
    line-height: 1;
    opacity: 1;
  }
</style>
