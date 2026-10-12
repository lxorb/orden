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
import { folderOf, nameOf } from '../space-paths'
import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'

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
async function made(folder: string, words: string): Promise<string | null> {
  const name = projectName(words)
  if (name === null) return null
  const path = joinPath(folder, workspace.freeName(folder, `${name}.md`))
  await writeFile(path, '')
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

/** A project at the top of the space's projects folder. */
export function addProject(root: string, words: string): Promise<string | null> {
  return made(projectsFolder(root), words)
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
  if (project.folder !== null) await workspace.rename(project.folder, name)
  else await workspace.rename(project.note, `${name}.md`)
}
