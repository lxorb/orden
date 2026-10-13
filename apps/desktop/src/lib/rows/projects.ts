/** Which folder of each space holds its projects (docs/tasks.md, the Todoist round).
 *
 *  `Projects/` at the root of a space unless the space says otherwise: an ordinary
 *  folder of notes, so it syncs, opens and links like any other, and Obsidian and an
 *  agent see exactly what the Tasks panel lists - a note per project, a folder note per
 *  project with sub-projects. Made the first time a project is added.
 *
 *  What a space says is kept by path and follows the folder, so a renamed projects folder
 *  stays the projects folder, the way the inbox follows its note (inbox.ts). A space that
 *  never moved it keeps nothing here. */

import { without } from '../records'
import { insideItsSpace, insideSpace, movedTo, pathKey, relativeTo, samePath } from '../space-paths'
import { forget, isRecord, isString, keep, stored } from '../stored'
import type { KeptByPath } from '../workspace/file-ops'

const STORAGE_KEY = 'nib:projects'

/** The projects folder of a space that says nothing else. */
const PROJECTS = 'Projects'

/** Every space's own projects folder, by root, relative to it. */
function read(): Record<string, string> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}
  const out: Record<string, string> = {}
  for (const [root, path] of Object.entries(saved)) {
    if (isString(path) && insideItsSpace(path)) out[root] = path
  }
  return out
}

function write(all: Record<string, string>) {
  if (Object.keys(all).length) keep(STORAGE_KEY, JSON.stringify(all))
  else forget(STORAGE_KEY)
}

function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

/** The projects folder of a space, relative to it. */
export function projectsOf(root: string): string {
  const all = read()
  const key = keyOf(all, root)
  return (key === undefined ? undefined : all[key]) ?? PROJECTS
}

/** The projects folder of a space, on this disk. */
export function projectsFolder(root: string): string {
  return insideSpace(root, projectsOf(root))
}

/** Makes another folder the space's projects folder; the default again where it is
 *  `Projects`. The settings' Projects folder row. */
export function setProjects(root: string, relative: string) {
  const kept = read()
  const key = keyOf(kept, root)
  const all = key === undefined ? kept : without(kept, key)
  write(pathKey(relative, root) === pathKey(PROJECTS, root) ? all : { ...all, [root]: relative })
}

/** The projects folder follows its folder: renamed, moved, or its space renamed or gone. */
export const projectFolders: KeptByPath = {
  moved(from, to, root) {
    if (root === null) return
    const now = projectsOf(root)
    const after = movedTo(now, relativeTo(root, from), relativeTo(root, to), root)
    if (after !== null) setProjects(root, after)
  },
  spaceMoved(from, to) {
    const all = read()
    const key = keyOf(all, from)
    const kept = key === undefined ? undefined : all[key]
    if (key === undefined || kept === undefined) return
    write({ ...without(all, key), [to]: kept })
  },
  forget(root) {
    const all = read()
    const key = keyOf(all, root)
    if (key === undefined) return
    write(without(all, key))
  },
}
