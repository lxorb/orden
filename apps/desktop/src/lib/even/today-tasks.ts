import type { ScannedNote, SpaceLinks } from '@orden/scan/note'
import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { AGENTS_NAME } from '../note-name'
import { homeRoot } from '../rows/home.svelte'
import { INBOX } from '../rows/inbox'
import { listedAt } from '../rows/todo-lists'
import { insideSpace, samePath, within } from '../space-paths'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'

const KEPT_FOR = 5 * 60_000

const scanned = new Map<string, { at: number; notes: Promise<readonly ScannedNote[]> }>()

let heard = false

function hear() {
  if (heard) return
  heard = true
  links.hearSaves((path) => {
    for (const root of scanned.keys()) if (within(root, path, root) !== null) scanned.delete(root)
  })
  workspace.fileOps.follow(() => scanned.clear())
}

function scan(root: string): Promise<readonly ScannedNote[]> {
  hear()
  const kept = scanned.get(root)
  if (kept && Date.now() - kept.at < KEPT_FOR) return kept.notes
  const notes = invoke<SpaceLinks>('scan_links', { root }).then(
    (found) => found.notes,
    () => {
      if (scanned.get(root)?.notes === notes) scanned.delete(root)
      return []
    },
  )
  scanned.set(root, { at: Date.now(), notes })
  return notes
}

async function notesOf(root: string): Promise<readonly ScannedNote[]> {
  if (samePath(links.rootOf(), root)) {
    await links.scanned()
    if (samePath(links.rootOf(), root)) return links.held()
  }
  return scan(root)
}

export async function todayHere(): Promise<{ at: string; space: string; text: string }[]> {
  const { clockOf, scannedTaskRows, scanRows, taskOut, todayTasks } =
    await import('@orden/bases/tasks')
  const shut = (root: string, path: string) => workspace.protection.locked(insideSpace(root, path))
  const rows = []
  const home = homeRoot()
  for (const space of workspace.shownSpaces) {
    const read = async (path: string) =>
      scanRows((await workspace.noteText(insideSpace(space.root, path))) ?? '').tasks
    const inbox = INBOX
    const notes = (await notesOf(space.root))
      .filter((note) => /\.(md|markdown)$/i.test(note.path))
      .filter((note) => !samePath(note.path, AGENTS_NAME, space.root))
      .filter((note) => !shut(space.root, note.path))
      .filter((note) => listedAt(space.root, note.path))
    for (const note of notes) {
      rows.push(...scannedTaskRows(space.name, note.path, note.tasks ?? (await read(note.path))))
    }
    const mine = home !== null && samePath(home, space.root)
    if (mine && !notes.some((note) => samePath(note.path, inbox, space.root))) {
      rows.push(...scannedTaskRows(space.name, inbox, await read(inbox)))
    }
  }
  return todayTasks(rows, clockOf(new Date()).today, modes.undatedInToday).map(taskOut)
}
