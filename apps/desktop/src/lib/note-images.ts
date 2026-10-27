/** Where a picture a note names actually is.
 *
 *  Two things ask: the editor, drawing it in the live preview, and the reading
 *  view, rendering the note. A bare file name is looked for anywhere in the
 *  space, the way Obsidian finds an attachment; anything else is a path beside
 *  the note. One rule in one place, so the two faces of a note show the same
 *  picture. */

import { imageUrl } from './images'
import { links } from './link-index.svelte'
import { assetUrl } from './tauri'

export function notePicture(src: string, notePath: string | null, source: string): string {
  // Looked for in the note's own space, which a note still open from another space
  // is not the active one.
  const found = !src.includes('/') ? links.fileFor(src, notePath) : null

  // A name the space answered to is already a whole path. It is handed straight on:
  // put back through the arithmetic for a path written beside a note, it would be
  // joined onto the note's folder a second time and `![[x.png]]` would name nowhere.
  if (found) return assetUrl(found)

  return imageUrl(src, notePath, source)
}
