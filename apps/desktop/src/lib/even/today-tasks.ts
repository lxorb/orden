import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { AGENTS_NAME } from '../note-name'
import { inboxOf } from '../rows/inbox'
import { listedAt } from '../rows/todo-lists'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'

export async function todayHere(): Promise<{ at: string; space: string; text: string }[]> {
  const space = workspace.activeSpace
  if (!space) return []
  const { clockOf, scannedTaskRows, scanRows, taskOut, todayTasks } =
    await import('@orden/bases/tasks')
  const read = async (path: string) =>
    scanRows((await workspace.noteText(insideSpace(space.root, path))) ?? '').tasks
  const inbox = inboxOf(space.root)
  const notes = links
    .held()
    .filter((note) => /\.(md|markdown)$/i.test(note.path))
    .filter((note) => !samePath(note.path, AGENTS_NAME, space.root))
    .filter((note) => listedAt(space.root, note.path))
  const rows = []
  for (const note of notes) {
    rows.push(...scannedTaskRows(space.name, note.path, note.tasks ?? (await read(note.path))))
  }
  if (!notes.some((note) => samePath(note.path, inbox, space.root))) {
    rows.push(...scannedTaskRows(space.name, inbox, await read(inbox)))
  }
  return todayTasks(rows, clockOf(new Date()).today, modes.undatedInToday).map(taskOut)
}
