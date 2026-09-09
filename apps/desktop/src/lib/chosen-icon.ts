/** The icon a row in the file list wears, wherever that icon is kept.
 *
 *  Three kinds of thing can wear one and each keeps it in the only place it has: a
 *  note in its front matter, a canvas under its `nib` key, a folder in the space's
 *  own map, because a folder is not a file. Which of the three a path is matters to
 *  whoever writes the icon and to nobody who draws it, so it is answered here once
 *  and every mark in the app asks this instead of asking three stores in three
 *  different ways.
 *
 *  A path as the app holds one or as the space speaks it, since both stores read
 *  both. See file-icon.ts and workspace/folder-icons.svelte.ts for the writing, and
 *  icons.ts for what the value says. */

import { links } from './link-index.svelte'
import { workspace } from './workspace.svelte'

export function chosenIcon(path: string): string | null {
  return links.iconOf(path) ?? workspace.folderIcons.iconOf(path)
}

/** The colour a stroked icon is drawn in, or null for the plain foreground.
 *
 *  A second value rather than part of the first, because the first is what other
 *  apps read: a note says `icon: rocket` and `icon-color: violet` on two lines, so
 *  Obsidian's Iconize still finds the icon and simply ignores the colour. A tint
 *  folded into the one value would have made every tinted icon a word Iconize does
 *  not know.
 *
 *  Only a stroked icon takes one; an emoji and a coloured drawing have their own
 *  colours. See `readTint` in icons.ts for which names count. */
export function chosenTint(path: string): string | null {
  return links.tintOf(path) ?? workspace.folderIcons.tintOf(path)
}
