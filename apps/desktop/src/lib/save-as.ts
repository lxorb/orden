/** "Save as", which is only ever about a file the app does not keep.
 *
 *  A note in a space needs no Save at all: it is written as it is typed and synced
 *  from there, so "save it somewhere else" would mean taking it out of the space,
 *  which is what an export is for. A file opened from anywhere else on the disk is
 *  the reader's own file, saved back to its own path, and that is the one for which
 *  "somewhere else" is a real thing to ask.
 *
 *  So this writes the words to a path the reader chooses and opens that file, the
 *  way every editor's Save as does: what is in front of them afterwards is the new
 *  file, and the old one is left as it was. */

import { chooseTarget, writeFile } from './export/save'
import { t } from './i18n.svelte'
import { isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

/** Whether a path is a file of its own on the disk rather than a note in a space.
 *  A note with no path at all is not one either: it has never been anywhere. */
export function isExternalFile(path: string | null): boolean {
  if (!path) return false
  return !workspace.spaces.some((space) => path.startsWith(space.root))
}

/** Whether the row is worth offering: a desktop, and a file of the reader's own
 *  in front of them. */
export function canSaveAs(): boolean {
  const note = workspace.active
  return isDesktop && note?.kind === 'note' && isExternalFile(note.path)
}

export async function saveAs(): Promise<void> {
  if (!canSaveAs()) return

  workspace.flush()
  const note = workspace.active
  if (!note) return

  const target = await chooseTarget(note.name, 'md', t('Markdown'))
  if (!target) return

  await writeFile(target, note.doc)
  await workspace.open(target)
}
