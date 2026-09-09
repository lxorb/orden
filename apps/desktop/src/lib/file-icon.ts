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
import { frontMatterEdit } from '@nib/markdown/front-matter'
import { isCanvasTarget } from '@nib/markdown/links'
import { iconValue } from './icons'
import { key, message } from './i18n.svelte'
import { reverse } from './search/replace'
import { settings } from './settings.svelte'
import { workspace } from './workspace.svelte'

/** Writes the icon a note or a canvas wears, or takes it away when `name` is
 *  null.
 *
 *  `name` is the library's own name for the icon, which is what the picker offers;
 *  the file is written with Lucide's plain spelling of it. Nothing is written
 *  where the file already says that, so choosing the icon it already wears costs
 *  no file, no snapshot and no undo step.
 *
 *  A file that cannot be written says so, the way renaming a tag does: this is
 *  somebody's file, and an icon that silently did not arrive would look like the
 *  picker being broken. */
export async function setFileIcon(path: string, name: string | null): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  const value = name === null ? null : iconValue(name)
  const edit = isCanvasTarget(path)
    ? canvasIconEdit(before, value)
    : frontMatterEdit(before, 'icon', value)
  if (!edit) return

  const after = before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  const edits = [edit]

  try {
    await workspace.replaceInNotes([{ path, before, after, edits, back: reverse(before, edits) }])
  } catch (error) {
    settings.error = message(error, key('That icon could not be written.'))
  }
}
