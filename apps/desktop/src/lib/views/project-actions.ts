/** What the Tasks panel does to a project: makes one, makes one inside another, names
 *  it again. A project is a note in the space's projects folder (rows/projects.ts), so
 *  each of these is the file list's own operation on that note, and the file list, the
 *  panel and every view of the note follow it the way they follow any rename or move
 *  (workspace/file-ops.ts).
 *
 *  A project is made empty, Todoist's way, and not with its name as a heading: a
 *  heading in a project is a section, and the first section of every new project would
 *  otherwise be its own name. */

import { folderFor } from '../folder-notes'
import { projectsFolder } from '../rows/projects'
import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu.svelte'
import { inboxOf } from '../rows/inbox'
import { inboxNote } from '../rows/inbox-note'
import { folderOf, insideSpace, nameOf, samePath, within } from '../space-paths'
import { joinPath } from '../tauri'
import { entryAt } from '../tree-edits'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { rewriteNotes } from './act'
import { type ProjectNode, projectNodes } from './project-tree'
import { retitled } from './sections'
import { templateWords } from './templates'

/** A file name a project may have: the words, without what a file name cannot hold. */
function projectName(words: string): string | null {
  const name = words
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name && !/^\.+$/.test(name) ? name : null
}

/** A new, empty project in a folder, under the first free name its words make; answers
 *  its note on this disk, or null where the words make no name. */
async function made(folder: string, words: string, template?: string): Promise<string | null> {
  const name = projectName(words)
  if (name === null) return null
  const path = joinPath(folder, workspace.freeName(folder, `${name}.md`))
  const text = template === undefined ? '' : await templateWords(template, name)
  await writeFile(path, text)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

/** A project at the top of the space's projects folder: empty, or from a template. */
export function addProject(root: string, words: string, template?: string): Promise<string | null> {
  return made(projectsFolder(root), words, template)
}

/** A project inside another. A project that is a folder already takes it in; one that
 *  is a note becomes a folder with its note in it first, the file list's own nesting
 *  (`A.md` to `A/A.md`), exactly as a drop onto it would. */
export async function addSubproject(
  parent: { note: string; folder: string | null },
  words: string,
): Promise<string | null> {
  if (parent.folder !== null) return made(parent.folder, words)
  const path = await made(folderOf(parent.note), words)
  if (path === null) return null
  const into = folderFor(parent.note)
  await workspace.moveMany([path], into)
  return joinPath(into, nameOf(path))
}

/** A project named again: a folder project's folder, which takes its note with it, or
 *  the note of one that is a note. */
export async function renameProject(
  project: { note: string; folder: string | null },
  words: string,
): Promise<void> {
  const name = projectName(words)
  if (name === null) return
  const was = nameOf(project.note).replace(/.md$/i, '')
  let note: string
  if (project.folder !== null) {
    await workspace.rename(project.folder, name)
    note = joinPath(joinPath(folderOf(project.folder), name), `${name}.md`)
  } else {
    await workspace.rename(project.note, `${name}.md`)
    note = joinPath(folderOf(project.note), `${name}.md`)
  }
  // A title that said the old name says the new one: it is the project's name too.
  await rewriteNotes([{ path: note, after: (text) => retitled(text, was, name) }])
}

/** The projects of a space, as the panel draws them; `count` answers a note's open
 *  tasks. */
export function spaceProjects(root: string, count: (note: string) => number): ProjectNode[] {
  const folder = entryAt(workspace.tree, projectsFolder(root))
  if (!folder?.is_dir) return []
  return projectNodes(folder, (path) => workspace.arranged.listOf(path), count)
}

/** A project's note written empty where it is not there yet: a folder's namesake, which
 *  the panel shows before anything is in it. */
async function ensureProject(note: string): Promise<void> {
  if (workspace.notes.some((one) => samePath(one.path, note))) return
  await writeFile(note, '')
  await workspace.loadTree()
  await workspace.fileCame(note, 'file')
}

/** The inbox of a space, on this disk, whether it is there yet or not. */
const inboxNoteAt = (root: string) => insideSpace(root, inboxOf(root))

/** The places a task or a section can be taken to, as menu rows: the Inbox and every
 *  project of the open space, a sub-project under its parent's name. `go` is handed the
 *  note on this disk, made first where it is not there yet; `here` ticks a row. */
export function placeEntries(
  go: (note: string) => void,
  here: (note: string) => boolean = () => false,
): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (root === undefined) return []
  const out: MenuEntry[] = [
    {
      label: t('Inbox'),
      checked: here(inboxNoteAt(root)),
      run: () => void inboxNote(root).then(go),
    },
  ]
  const walk = (nodes: readonly ProjectNode[], above: string) => {
    for (const node of nodes) {
      const name = above ? `${above} / ${node.name}` : node.name
      out.push({
        label: name,
        checked: here(node.note),
        run: () => void ensureProject(node.note).then(() => go(node.note)),
      })
      walk(node.children, name)
    }
  }
  walk(
    spaceProjects(root, () => 0),
    '',
  )
  return out
}

/** The project a note is, as the panel has it: a folder's namesake renamed with its
 *  folder. A note that is no project of the open space is one on its own. */
export function projectAt(note: string): { note: string; folder: string | null } {
  const root = workspace.activeSpace?.root
  const walk = (nodes: readonly ProjectNode[]): ProjectNode | undefined => {
    for (const node of nodes) {
      if (samePath(node.note, note)) return node
      const inner = walk(node.children)
      if (inner) return inner
    }
    return undefined
  }
  const found = root === undefined ? undefined : walk(spaceProjects(root, () => 0))
  return { note, folder: found?.folder ?? null }
}

/** Where a project is in the file list: its folder, or its note. */
const placeOf = (project: { note: string; folder: string | null }) => project.folder ?? project.note

/** A project put just before or after another, the file list's own Manual order of the
 *  folder they share (`placedBeside`), so the panel and the file list stay one order. A
 *  project from another folder is moved into that one first, as a drop there would.
 *  Nothing happens for a project put beside itself or inside its own sub-projects. */
export async function placeProject(
  moving: { note: string; folder: string | null },
  target: { note: string; folder: string | null },
  after: boolean,
): Promise<void> {
  let path = placeOf(moving)
  const beside = placeOf(target)
  if (samePath(path, beside) || within(path, beside) !== null) return
  const folder = folderOf(beside)
  if (!samePath(folderOf(path), folder)) {
    await workspace.moveMany([path], folder)
    path = joinPath(folder, nameOf(path))
  }
  const { placedBeside } = await import('../tree-arranging')
  const children = entryAt(workspace.tree, folder)?.children ?? []
  const names = placedBeside(
    children,
    workspace.arranged.savedList(folder),
    [nameOf(path)],
    nameOf(beside),
    after,
  )
  workspace.arranged.set(folder, names)
}

/** A new project just above or below another, Todoist's Add project above and below. */
export async function addProjectBeside(
  target: { note: string; folder: string | null },
  words: string,
  after: boolean,
): Promise<string | null> {
  const path = await made(folderOf(placeOf(target)), words)
  if (path === null) return null
  await placeProject({ note: path, folder: null }, target, after)
  return path
}
