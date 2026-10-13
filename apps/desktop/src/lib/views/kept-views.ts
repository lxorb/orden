/** What a view keeps on this device and nowhere else, as Todoist's apps do: which of
 *  a list's groups are folded, and how each project is laid out - list or board, its
 *  grouping, its sorting - so a project opened again comes back as it was left.
 *
 *  Kept by the view's name (`viewKey`): a project by its space and its note, a view nib
 *  ships by its name, a base by its file. */

import { isRecord, keep, stored, stringList } from '../stored'
import type { ViewSpec } from './spec'

const FOLDS = 'nib:view-folds'
const PROJECTS = 'nib:project-views'

/** How many views keep their folds: the ones folded most lately. */
const MOST = 200

/** The name a view keeps its folds under, or null for one that keeps none (a fence). */
export function viewKey(spec: ViewSpec, file: string | null): string | null {
  if (file !== null) return `file:${file}`
  if (spec.builtin === 'project') return `project:${spec.space ?? ''}/${spec.path ?? ''}`
  if (spec.builtin === 'label') return `label:${spec.tag ?? ''}`
  return spec.builtin ?? null
}

function read(key: string): Record<string, unknown> {
  const all = stored(key)
  return isRecord(all) ? all : {}
}

/** The groups a view was left with folded. */
export function foldsOf(key: string | null): ReadonlySet<string> {
  if (key === null) return new Set()
  return new Set(stringList(read(FOLDS)[key]) ?? [])
}

/** The groups a view has folded now, kept for the next time it is drawn. */
export function keepFolds(key: string | null, folded: ReadonlySet<string>): void {
  if (key === null) return
  const all = Object.fromEntries(Object.entries(read(FOLDS)).filter(([one]) => one !== key))
  if (folded.size) all[key] = [...folded]
  const kept = Object.entries(all).slice(-MOST)
  keep(FOLDS, JSON.stringify(Object.fromEntries(kept)))
}

/** How a project was last laid out here, as its base's words, if it was changed. */
export function projectView(space: string, path: string): string | undefined {
  const words = read(PROJECTS)[`${space}/${path}`]
  return typeof words === 'string' ? words : undefined
}

/** How a project is laid out now, kept for the next time it is opened. */
export function keepProjectView(space: string, path: string, words: string): void {
  const all = read(PROJECTS)
  all[`${space}/${path}`] = words
  keep(PROJECTS, JSON.stringify(all))
}

/** The layouts kept for a space's projects, moved along with their notes: `moved` answers
 *  where a path is now (or null where it did not move), `follow` the words about it there. */
export function followProjectViews(
  space: string,
  moved: (path: string) => string | null,
  follow: (words: string, from: string, to: string) => string,
): void {
  const all = read(PROJECTS)
  const out: Record<string, unknown> = {}
  let changed = false
  for (const [key, words] of Object.entries(all)) {
    const path = key.startsWith(`${space}/`) ? key.slice(space.length + 1) : null
    const now = path === null ? null : moved(path)
    if (path === null || now === null || now === path || typeof words !== 'string') {
      out[key] = words
      continue
    }
    out[`${space}/${now}`] = follow(words, path, now)
    changed = true
  }
  if (changed) keep(PROJECTS, JSON.stringify(out))
}
