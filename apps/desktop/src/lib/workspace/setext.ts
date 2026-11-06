import type { Change } from '../search/apply'
import { changeOf } from '../search/replace'
import { samePath } from '../space-paths'
import { keepJson, stored } from '../stored'
import { type HoldsNotes, noteText, replaceInNotes } from './note-text'

export const SETEXT_GONE = 'nib:setext-gone'

const AFTER_THE_LAUNCH = 30_000

function spacesDone(): string[] {
  const said = stored(SETEXT_GONE)
  return Array.isArray(said) ? said.filter((one): one is string => typeof one === 'string') : []
}

export async function dropSetext(
  ws: HoldsNotes,
  root: string,
  waits = AFTER_THE_LAUNCH,
): Promise<number> {
  if (spacesDone().some((one) => samePath(one, root))) return 0

  await new Promise((go) => setTimeout(go, waits))
  if (!samePath(ws.activeSpace?.root, root)) return 0

  const { setextEdits } = await import('@orden/editor/setext')
  const changes: Change[] = []

  for (const note of ws.notes) {
    if (!samePath(ws.activeSpace?.root, root)) return 0

    const before = await noteText(ws, note.path)
    if (before === null) continue

    const edits = setextEdits(before)
    if (edits.length) changes.push(changeOf(note.path, before, edits))
  }

  const written = changes.length ? await replaceInNotes(ws, changes, { undoable: false }) : 0
  keepJson(SETEXT_GONE, [...spacesDone(), root])
  return written
}
