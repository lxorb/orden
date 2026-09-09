/** Giving a note an icon, and taking it away again.
 *
 *  It goes in the note's own front matter, under `icon:`, which is the one place
 *  that makes it the note's rather than this machine's: it syncs with the file,
 *  it survives a copy to another vault, and Obsidian reads it as metadata like
 *  any other. A space's icon is a device's own choice and lives in this device's
 *  store; a note's icon is part of the note. See icons.ts for what the value
 *  says.
 *
 *  Written the way renaming a tag is written, and for the same reason: through
 *  the workspace, as an edit the size of the words that changed. So a note open
 *  in a pane takes the change in its editor rather than being read back off the
 *  disk under its reader's caret, the version before it is snapshotted, and one
 *  undo puts it back. See tag-edits.ts, which is the same shape of change. */

import { frontMatterEdit } from '@nib/markdown/front-matter'
import { iconValue } from './icons'
import { key, message } from './i18n.svelte'
import { reverse } from './search/replace'
import { settings } from './settings.svelte'
import { workspace } from './workspace.svelte'

/** Writes the icon a note wears, or takes it away when `name` is null.
 *
 *  `name` is the library's own name for the icon, which is what the picker offers;
 *  the note is written with Lucide's plain spelling of it. Nothing is written
 *  where the note already says that, so choosing the icon a note already wears
 *  costs no file, no snapshot and no undo step.
 *
 *  A note that cannot be written says so, the way renaming a tag does: this is
 *  somebody's file, and an icon that silently did not arrive would look like the
 *  picker being broken. */
export async function setNoteIcon(path: string, name: string | null): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  const edit = frontMatterEdit(before, 'icon', name === null ? null : iconValue(name))
  if (!edit) return

  const after = before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  const edits = [edit]

  try {
    await workspace.replaceInNotes([{ path, before, after, edits, back: reverse(before, edits) }])
  } catch (error) {
    settings.error = message(error, key('That icon could not be written.'))
  }
}
