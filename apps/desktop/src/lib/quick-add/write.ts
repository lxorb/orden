/** A task from quick add, written into its note (docs/tasks.md 5.6).
 *
 *  Where it lands: the note `>` named, made where the space has none by that name, the
 *  way a link makes the note it names; else the note the add button belongs to; else
 *  the reader's one inbox, whatever space is in front (rows/home.svelte.ts), made the first
 *  time. The line goes in through the one road every write across a space takes
 *  (`replaceInNotes`), so a note open in a pane takes the line as an edit of its own,
 *  nothing typed there is lost, and the add is one thing to undo. Ctrl+Enter opens the note at the line. */

import { meansInbox } from '@orden/bases/inbox'
import { insideOnly } from '../automation/inside'
import { changeOf } from '../search/replace'
import {
  folderOf,
  insideSpace,
  isMarkdownPath,
  nameOf,
  relativeTo,
  samePath,
  withoutExtension,
} from '../space-paths'
import { links } from '../link-index.svelte'
import { isAgentsName } from '../note-name'
import { onDisk } from '../on-disk'
import { readIfThere, toldIfUnreadable } from '../read-if-there'
import { canWriteAt } from '../sharing.svelte'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { writeFile } from '../workspace/write-file'
import { type Entry, linesOf, placeIn } from './entry'

/** The space's notes by name, recent first: what `>` reads and the where control offers. */
export function noteNames(root: string): string[] {
  const recent = new Map(workspace.recent.map((path, index) => [path, index]))
  return workspace.notes
    .filter((one) => isMarkdownPath(one.path))
    .sort((a, b) => (recent.get(a.path) ?? 1e9) - (recent.get(b.path) ?? 1e9))
    .map((one) => withoutExtension(relativeTo(root, one.path)))
}

/** The headings of the note a `>` names, as the link index read them, for `/`. */
export function headingsOf(root: string, said: string): readonly string[] {
  const path = named(root, said)
  if (path === null) return []
  const relative = relativeTo(root, path)
  return links.held().find((one) => one.path === relative)?.headings ?? []
}

/** The note a `>` names: one whose path or name is the words, case aside. Only a
 *  note: a task line written into a chat, a canvas or a shortcut spoils it.
 *
 *  And composed alike: a Mac keeps `Café` with the accent as a character of its
 *  own and a keyboard types it inside the letter, and compared as written the
 *  note was not found and made again, empty, over itself. */
function named(root: string, said: string): string | null {
  const key = (words: string) => words.normalize('NFC').toLowerCase()
  const wanted = key(said.replace(/\.md$/i, ''))
  const notes = workspace.notes.filter((one) => isMarkdownPath(one.path))
  const found =
    notes.find((one) => key(withoutExtension(relativeTo(root, one.path))) === wanted) ??
    notes.find((one) => key(withoutExtension(one.name)) === wanted.split('/').at(-1))
  return found?.path ?? null
}

/** The path a task goes to, the note made where it is not there yet. Null where the
 *  words name somewhere outside the space, or no space is open. */
async function targetOf(entry: Entry, root: string): Promise<string | null> {
  if (entry.note === undefined) return null
  const existing = named(root, entry.note)
  if (existing) return existing

  const relative = insideOnly(`${entry.note.replace(/\.md$/i, '')}.md`)
  if (relative === null) return null
  const path = insideSpace(root, relative)
  if (isAgentsName(nameOf(path)) && (samePath(folderOf(path), root) || !(await onDisk(path)))) {
    void import('../reserved-name.svelte').then((one) => one.reservedName.tell(root))
    return null
  }
  // The listing is a round trip behind the disk, and a name it misses can still be
  // a note with words in it: writing the empty file then replaced them, with no
  // version kept. So the disk is asked first, and a note that is there is used.
  if (await onDisk(path)) return path
  await writeFile(path, '')
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

/** A space shared to be read takes nothing, not even the inbox the add would make: the
 *  copy here would stop being the space's, and the sync refuses it on every pass. */
async function pathFor(entry: Entry, given: string | undefined): Promise<string | null> {
  const root = given ?? workspace.activeSpace?.root
  // `>Inbox`, where no note of the reader's has that name, is the inbox (#1044).
  const inbox =
    entry.note === undefined ||
    (meansInbox(entry.note) && (root === undefined || named(root, entry.note) === null))
  const into =
    inbox && given === undefined ? (await import('../rows/home.svelte')).homeRoot() : root
  if (into === null || into === undefined || !canWriteAt(into)) return null
  if (!inbox) return targetOf(entry, into)
  const { inboxNote } = await import('../rows/inbox-note')
  return inboxNote(into)
}

/** Writes the task; answers where it went, or null where it went nowhere, which is
 *  also the answer where no space shared with this account may take it. */
export async function addTask(
  entry: Entry,
  options: { open?: boolean; root?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const path = await pathFor(entry, options.root)
  if (path === null) return null

  // A note that would not read is not an empty one: the read is asked again of the
  // disk, which throws for one that is there, and the reader is told it was kept.
  let before: string
  try {
    before = (await noteText(workspace, path)) ?? (await readIfThere(path)) ?? ''
  } catch (error) {
    return toldIfUnreadable(error)
  }
  const placed = placeIn(before, linesOf(entry), entry.heading)
  await replaceInNotes(workspace, [
    changeOf(path, before, [{ from: placed.at, to: placed.at, insert: placed.insert }]),
  ])

  if (options.open) {
    await workspace.open(path)
    workspace.goto = { path, line: placed.line }
  }
  return { path, line: placed.line }
}
