import { folderFor } from '../folder-notes'
import { projectsFolder } from '../rows/projects'
import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu.svelte'
import { inboxOf } from '../rows/inbox'
import { inboxNote } from '../rows/inbox-note'
import { isAgentsName } from '../note-name'
import { canWriteAt } from '../sharing.svelte'
import { folderOf, insideSpace, nameOf, samePath, within } from '../space-paths'
import { joinPath } from '../tauri'
import { entryAt } from '../tree-edits'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { rewriteNotes } from './act'
import { type ProjectNode, projectNodes } from './project-tree'
import { retitled } from './sections'
import { templateWords } from './templates'

function projectName(words: string): string | null {
  const name = words
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name && !/^\.+$/.test(name) ? name : null
}

function refused(path: string, name: string): boolean {
  if (!isAgentsName(`${name}.md`)) return false
  const root = workspace.rootHolding(path)
  if (root !== null)
    void import('../reserved-name.svelte').then((one) => one.reservedName.tell(root))
  return true
}

async function made(folder: string, words: string, template?: string): Promise<string | null> {
  const name = projectName(words)
  if (name === null || !canWriteAt(folder) || refused(folder, name)) return null
  const path = joinPath(folder, await workspace.freeNameOnDisk(folder, `${name}.md`))
  const text = template === undefined ? '' : await templateWords(template, name)
  await writeFile(path, text)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

export function addProject(root: string, words: string, template?: string): Promise<string | null> {
  return made(projectsFolder(root), words, template)
}

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

export async function renameProject(
  project: { note: string; folder: string | null },
  words: string,
): Promise<void> {
  const name = projectName(words)
  if (name === null || refused(project.note, name)) return
  const was = nameOf(project.note).replace(/.md$/i, '')
  let note: string
  if (project.folder !== null) {
    await workspace.rename(project.folder, name)
    note = joinPath(joinPath(folderOf(project.folder), name), `${name}.md`)
  } else {
    await workspace.rename(project.note, `${name}.md`)
    note = joinPath(folderOf(project.note), `${name}.md`)
  }
  await rewriteNotes([{ path: note, after: (text) => retitled(text, was, name) }])
}

function spaceProjects(root: string, count: (note: string) => number): ProjectNode[] {
  const folder = entryAt(workspace.tree, projectsFolder(root))
  if (!folder?.is_dir) return []
  return projectNodes(folder, (path) => workspace.arranged.listOf(path), count)
}

async function ensureProject(note: string): Promise<boolean> {
  if (workspace.notes.some((one) => samePath(one.path, note))) return true
  if (!canWriteAt(note)) return false
  await writeFile(note, '')
  await workspace.loadTree()
  await workspace.fileCame(note, 'file')
  return true
}

const inboxNoteAt = (root: string) => insideSpace(root, inboxOf(root))

export function offersPlaces(): boolean {
  const root = workspace.activeSpace?.root
  return root !== undefined && canWriteAt(root)
}

export function placeEntries(
  go: (note: string) => void,
  here: (note: string) => boolean = () => false,
): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (root === undefined || !offersPlaces()) return []
  const out: MenuEntry[] = [
    {
      label: t('Inbox'),
      checked: here(inboxNoteAt(root)),
      run: () =>
        void inboxNote(root).then(
          (note) => (note === null ? undefined : go(note)),
          () => undefined,
        ),
    },
  ]
  const walk = (nodes: readonly ProjectNode[], above: string) => {
    for (const node of nodes) {
      const name = above ? `${above} / ${node.name}` : node.name
      out.push({
        label: name,
        checked: here(node.note),
        run: () =>
          void ensureProject(node.note).then((there) => (there ? go(node.note) : undefined)),
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

const placeOf = (project: { note: string; folder: string | null }) => project.folder ?? project.note

async function placeProject(
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
