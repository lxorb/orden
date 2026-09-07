/** Where a picture a note names actually is.
 *
 *  Two things ask: the editor, drawing it in the live preview, and the reading
 *  view, rendering the note. A bare file name is looked for anywhere in the
 *  space, the way Obsidian finds an attachment; anything else is a path beside
 *  the note. One rule in one place, so the two faces of a note show the same
 *  picture. */

import { imageUrl } from './images'
import { links } from './link-index.svelte'
import { workspace } from './workspace.svelte'

export function notePicture(src: string, notePath: string | null, source: string): string {
  const root = workspace.activeSpace?.root
  const found = root && !src.includes('/') ? links.fileNamed(src) : null
  const path = found && root ? `${root}/${found}` : src

  return imageUrl(path, notePath, source)
}
