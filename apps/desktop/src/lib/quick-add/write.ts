import { meansInbox } from '@orden/bases/inbox'
import { insideOnly } from '../automation/inside'
import { changeOf } from '../search/replace'
import {
  folderOf,
  insideSpace,
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
import { writeIfAbsent } from '../workspace/write-file'
import { type Entry, linesOf, placeIn } from './entry'
import { isListed, listNamed, listsIn, makeList } from '../rows/todo-lists'

export function noteNames(root: string): string[] {
  const recent = new Map(workspace.recent.map((path, index) => [relativeTo(root, path), index]))
  return listsIn(root)
    .sort((a, b) => (recent.get(a) ?? 1e9) - (recent.get(b) ?? 1e9))
    .map((one) => withoutExtension(one))
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
  const lists = listsIn(root)
  const found =
    lists.find((one) => key(withoutExtension(one)) === wanted) ??
    lists.find((one) => key(withoutExtension(nameOf(one))) === wanted.split('/').at(-1))
  return found === undefined ? null : insideSpace(root, found)
}

async function targetOf(entry: Entry, root: string): Promise<string | null> {
  if (entry.note === undefined) return null
  const existing = named(root, entry.note)
  if (existing) return existing

  const said = insideOnly(`${entry.note.replace(/\.md$/i, '')}.md`)
  const relative = said === null ? null : listNamed(root, said)
  if (relative === null) return null
  const path = insideSpace(root, relative)
  if (isAgentsName(nameOf(path)) && (samePath(folderOf(path), root) || !(await onDisk(path)))) {
    void import('../reserved-name.svelte').then((one) => one.reservedName.tell(root))
    return null
  }
  if (!(await writeIfAbsent(path, ''))) return isListed(path) ? path : null
  makeList(path)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

async function pathFor(entry: Entry, given: string | undefined): Promise<string | null> {
  const root = given ?? workspace.activeSpace?.root
  const inbox =
    entry.note === undefined ||
    (meansInbox(entry.note) && (root === undefined || named(root, entry.note) === null))
  if (inbox) return (await import('../rows/inbox-note')).inboxNote()
  if (root === undefined || !canWriteAt(root)) return null
  return targetOf(entry, root)
}

let adding: Promise<unknown> = Promise.resolve()

export async function addTask(
  entry: Entry,
  options: { open?: boolean; root?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const added = adding.then(() => addOne(entry, options.root))
  adding = added.catch(() => undefined)
  const landed = await added
  if (landed && options.open) {
    await workspace.open(landed.path)
    workspace.goto = { ...landed }
  }
  return landed
}

async function addOne(
  entry: Entry,
  root: string | undefined,
): Promise<{ path: string; line: number } | null> {
  const path = await pathFor(entry, root)
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
  return { path, line: placed.line }
}
