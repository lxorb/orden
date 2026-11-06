import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { AGENTS_NAME } from '../note-name'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'

export async function todayHere(): Promise<{ at: string; space: string; text: string }[]> {
  const space = workspace.activeSpace
  if (!space) return []
  const { clockOf, scannedTaskRows, scanRows, taskOut, todayTasks } =
    await import('@orden/bases/tasks')
  const rows = []
  for (const note of links.held()) {
    if (samePath(note.path, AGENTS_NAME, space.root)) continue
    if (!/\.(md|markdown)$/i.test(note.path)) continue
    const tasks =
      note.tasks ??
      scanRows((await workspace.noteText(insideSpace(space.root, note.path))) ?? '').tasks
    rows.push(...scannedTaskRows(space.name, note.path, tasks))
  }
  return todayTasks(rows, clockOf(new Date()).today, modes.undatedInToday).map(taskOut)
}
