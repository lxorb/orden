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
  within,
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

export function noteNames(root: string): string[] {
  const recent = new Map(workspace.recent.map((path, index) => [path, index]))
  return workspace.notes
    .filter((one) => isMarkdownPath(one.path))
    .sort((a, b) => (recent.get(a.path) ?? 1e9) - (recent.get(b.path) ?? 1e9))
    .map((one) => withoutExtension(relativeTo(root, one.path)))
}

export function headingsOf(root: string, said: string): readonly string[] {
  const path = named(root, said)
  if (path === null) return []
  const relative = relativeTo(root, path)
  return links.held().find((one) => one.path === relative)?.headings ?? []
}

function named(root: string, said: string): string | null {
  const key = (words: string) => words.normalize('NFC').toLowerCase()
  const wanted = key(said.replace(/\.md$/i, ''))
  const notes = workspace.notes.filter(
    (one) => isMarkdownPath(one.path) && within(root, one.path, root) !== null,
  )
  const found =
    notes.find((one) => key(withoutExtension(relativeTo(root, one.path))) === wanted) ??
    notes.find((one) => key(withoutExtension(one.name)) === wanted.split('/').at(-1))
  return found?.path ?? null
}

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
  if (await onDisk(path)) return path
  await writeFile(path, '')
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

async function pathFor(entry: Entry, given: string | undefined): Promise<string | null> {
  const root = given ?? workspace.activeSpace?.root
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

export async function addTask(
  entry: Entry,
  options: { open?: boolean; root?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const path = await pathFor(entry, options.root)
  if (path === null) return null

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
