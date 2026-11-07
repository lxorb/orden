import { without } from '../records'
import {
  insideItsSpace,
  insideSpace,
  isMarkdownPath,
  movedTo,
  pathKey,
  relativeTo,
  samePath,
  within,
} from '../space-paths'
import { forget, isRecord, isString, keepJson, stored } from '../stored'
import type { KeptByPath } from '../workspace/file-ops'

const STORAGE_KEY = 'orden:projects'

const PROJECTS = 'Projects'

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
  if (Object.keys(all).length) keepJson(STORAGE_KEY, all)
  else forget(STORAGE_KEY)
}

function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

export function projectsOf(root: string): string {
  const all = read()
  const key = keyOf(all, root)
  return (key === undefined ? undefined : all[key]) ?? PROJECTS
}

export function inProjects(root: string, relative: string): boolean {
  return isMarkdownPath(relative) && !!within(projectsOf(root), relative, root)
}

export function projectsFolder(root: string): string {
  return insideSpace(root, projectsOf(root))
}

export function setProjects(root: string, relative: string) {
  const kept = read()
  const key = keyOf(kept, root)
  const all = key === undefined ? kept : without(kept, key)
  write(pathKey(relative, root) === pathKey(PROJECTS, root) ? all : { ...all, [root]: relative })
}

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
