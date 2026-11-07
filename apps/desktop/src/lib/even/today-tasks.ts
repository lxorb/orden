import type { ScannedNote, SpaceLinks } from '@orden/scan/note'
import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { AGENTS_NAME } from '../note-name'
import { inboxOf } from '../rows/inbox'
import { listedAt } from '../rows/todo-lists'
import { insideSpace, samePath } from '../space-paths'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'

async function notesOf(root: string): Promise<readonly ScannedNote[]> {
  if (samePath(links.rootOf(), root)) {
    await links.scanned()
    if (samePath(links.rootOf(), root)) return links.held()
  }
  return (await invoke<SpaceLinks>('scan_links', { root }).catch(() => null))?.notes ?? []
}

export async function todayHere(): Promise<{ at: string; space: string; text: string }[]> {
  const { clockOf, scannedTaskRows, scanRows, taskOut, todayTasks } =
    await import('@orden/bases/tasks')
  const shut = (root: string, path: string) => workspace.protection.locked(insideSpace(root, path))
  const rows = []
  for (const space of workspace.shownSpaces) {
    const read = async (path: string) =>
      scanRows((await workspace.noteText(insideSpace(space.root, path))) ?? '').tasks
    const inbox = inboxOf(space.root)
    const notes = (await notesOf(space.root))
      .filter((note) => /\.(md|markdown)$/i.test(note.path))
      .filter((note) => !samePath(note.path, AGENTS_NAME, space.root))
      .filter((note) => !shut(space.root, note.path))
      .filter((note) => listedAt(space.root, note.path))
    for (const note of notes) {
      rows.push(...scannedTaskRows(space.name, note.path, note.tasks ?? (await read(note.path))))
    }
    if (!shut(space.root, inbox) && !notes.some((note) => samePath(note.path, inbox, space.root))) {
      rows.push(...scannedTaskRows(space.name, inbox, await read(inbox)))
    }
  }
  return todayTasks(rows, clockOf(new Date()).today, modes.undatedInToday).map(taskOut)
}
