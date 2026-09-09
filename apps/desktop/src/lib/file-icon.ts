/** Giving a file an icon, and taking it away again.
 *
 *  It goes in the file itself, which is the one place that makes it the file's
 *  rather than this machine's: it syncs with the file, it survives a copy to
 *  another vault, and Obsidian reads it as metadata like any other. A note says it
 *  under `icon:` in its front matter; a canvas says it under `nib.icon`, because
 *  JSON has no front matter and that key is the one place the JSON Canvas spec
 *  leaves for something no other app has to look at. See icons.ts for what the
 *  value says.
 *
 *  A space's icon is a device's own choice and lives in this device's store, and a
 *  folder's is a per-space map, because neither is a file with anywhere to keep
 *  one; see workspace/device.svelte.ts and workspace/folder-icons.svelte.ts.
 *
 *  Written the way renaming a tag is written, and for the same reason: through
 *  the workspace, as an edit the size of the words that changed. So a note open
 *  in a pane takes the change in its editor rather than being read back off the
 *  disk under its reader's caret, an open canvas takes it in the plane it is
 *  drawn from, the version before it is snapshotted, and one undo puts it back.
 *  See tag-edits.ts, which is the same shape of change. */

import { canvasIconEdit } from '@nib/markdown/canvas'
import { frontMatterEdits } from '@nib/markdown/front-matter'
import { isCanvasTarget } from '@nib/markdown/links'
import { ICON_COLOUR_KEY, ICON_KEY, readTint } from './icons'
import { key, message } from './i18n.svelte'
import { reverse } from './search/replace'
import { settings } from './settings.svelte'
import { workspace } from './workspace.svelte'

/** Writes the icon a note or a canvas wears, or takes it away when `value` is null.
 *
 *  `value` is the written form the picker composed - an emoji, a Lucide name, or
 *  `set:name`; see `writtenIcon` in icons.ts. `tint` is the colour a stroked icon is
 *  drawn in, and goes in beside it under a key of its own so that another app reading
 *  the file still finds the icon. Both in one write, so choosing an icon is one thing
 *  to undo.
 *
 *  Nothing is written where the file already says that, so choosing the icon it
 *  already wears costs no file, no snapshot and no undo step.
 *
 *  A file that cannot be written says so, the way renaming a tag does: this is
 *  somebody's file, and an icon that silently did not arrive would look like the
 *  picker being broken. */
export async function setFileIcon(
  path: string,
  value: string | null,
  tint: string | null = null,
): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  // A colour with no icon to colour is not a colour, and a tint this build has never
  // heard of is not one either: both come out as no key at all.
  const colour = value === null ? null : readTint(tint)

  const edit = isCanvasTarget(path)
    ? canvasIconEdit(before, value, colour)
    : frontMatterEdits(before, [
        [ICON_KEY, value],
        [ICON_COLOUR_KEY, colour],
      ])
  if (!edit) return

  const after = before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  const edits = [edit]

  try {
    await workspace.replaceInNotes([{ path, before, after, edits, back: reverse(before, edits) }])
  } catch (error) {
    settings.error = message(error, key('That icon could not be written.'))
  }
}
