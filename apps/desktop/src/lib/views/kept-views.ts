/** What a view keeps on this device and nowhere else, as Todoist's apps do: which of
 *  a list's groups are folded, and how each project and each space's Todos is laid out -
 *  list or board, its grouping, its sorting - so it comes back as it was left.
 *
 *  Kept by the view's name (`viewKey`): a project by its space and its note, a view Orden
 *  ships by its name, a base by its file. */

import { isRecord, keepJson, stored, stringList } from '../stored'
import type { ViewSpec } from './spec'

const FOLDS = 'nib:view-folds'
const PROJECTS = 'nib:project-views'
const TODOS = 'nib:todos-views'
const RENAMES = 'nib:space-renames'

/** How many views keep their folds: the ones folded most lately. */
const MOST = 200

/** The name a view keeps its folds under, or null for one that keeps none (a fence). */
export function viewKey(spec: ViewSpec, file: string | null): string | null {
  if (file !== null) return `file:${file}`
  if (spec.builtin === 'project') return `project:${spec.space ?? ''}/${spec.path ?? ''}`
  if (spec.builtin === 'label') return `label:${spec.tag ?? ''}`
  if (spec.builtin === 'todos') return `todos:${spec.space ?? ''}`
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
  keepJson(FOLDS, Object.fromEntries(kept))
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
  keepJson(PROJECTS, all)
}

/** How a space's Todos was last laid out here - its layout, grouping, sorting, filters
 *  and whether done tasks show - as its base's words, if it was changed (#1046). */
export function todosView(space: string): string | undefined {
  const words = read(TODOS)[space]
  return typeof words === 'string' ? words : undefined
}

/** How a space's Todos is laid out now, kept for the next time it is opened; none, put
 *  back as Orden ships it. */
export function keepTodosView(space: string, words: string | undefined): void {
  const all = Object.fromEntries(Object.entries(read(TODOS)).filter(([one]) => one !== space))
  if (words !== undefined) all[space] = words
  keepJson(TODOS, all)
}

/** A key of the folds that is about a space's Todos or one of its projects, as the name
 *  after the space. */
function foldOf(key: string, space: string): string | null {
  if (key === `todos:${space}`) return ''
  const project = `project:${space}/`
  return key.startsWith(project) ? key.slice(project.length) : null
}

/** What is kept under a space's name, moved to the name it has now: its Todos, its
 *  projects, and which of their groups are folded. `follow` answers the words about it
 *  there. */
export function followSpaceViews(
  from: string,
  to: string,
  follow: (words: string) => string,
): void {
  const todos = read(TODOS)
  const words = todos[from]
  if (typeof words === 'string') {
    const rest = Object.fromEntries(Object.entries(todos).filter(([one]) => one !== from))
    keepJson(TODOS, { ...rest, [to]: follow(words) })
  }
  followProjectViews(from, (path) => path, follow, to)
  const folds = read(FOLDS)
  const moved = Object.entries(folds).map(([key, groups]): [string, unknown] => {
    const rest = foldOf(key, from)
    if (rest === null) return [key, groups]
    return [rest === '' ? `todos:${to}` : `project:${to}/${rest}`, groups]
  })
  if (moved.some(([key], at) => key !== Object.keys(folds)[at]))
    keepJson(FOLDS, Object.fromEntries(moved))
}

/** What was kept under a space's name, gone with the name, so a space called that later
 *  does not start as this one was left. Where it had moved from goes too. */
export function forgetSpaceViews(space: string): void {
  const todos = read(TODOS)
  if (space in todos)
    keepJson(
      TODOS,
      without(todos, (one) => one === space),
    )
  const projects = read(PROJECTS)
  const under = (key: string) => key.startsWith(`${space}/`)
  if (Object.keys(projects).some(under)) keepJson(PROJECTS, without(projects, under))
  const folds = read(FOLDS)
  const folded = (key: string) => foldOf(key, space) !== null
  if (Object.keys(folds).some(folded)) keepJson(FOLDS, without(folds, folded))
  const renames = read(RENAMES)
  const named = Object.fromEntries(
    Object.entries(renames).filter(([from, to]) => from !== space && to !== space),
  )
  if (Object.keys(named).length !== Object.keys(renames).length) keepJson(RENAMES, named)
}

function without(all: Record<string, unknown>, gone: (key: string) => boolean) {
  return Object.fromEntries(Object.entries(all).filter(([key]) => !gone(key)))
}

/** That a space on this device took another name, which is the one thing that tells a tab
 *  still about the old one from a tab about a space that is gone (`source.ts`). */
export function spaceRenamed(from: string, to: string): void {
  const all = without(read(RENAMES), (key) => key === to)
  keepJson(RENAMES, { ...all, [from]: to })
}

/** The name a space that was called this goes by now, as far as this device knows. */
export function renamedTo(space: string): string | undefined {
  const all = read(RENAMES)
  const seen = new Set([space])
  let now: string | undefined
  for (let at = all[space]; typeof at === 'string' && !seen.has(at); at = all[at]) {
    seen.add(at)
    now = at
  }
  return now
}

/** The layouts kept for a space's projects, moved along with their notes: `moved` answers
 *  where a path is now (or null where it did not move), `follow` the words about it there,
 *  and `into` the space it is in now, for a note moved into another one. */
export function followProjectViews(
  space: string,
  moved: (path: string) => string | null,
  follow: (words: string, from: string, to: string) => string,
  into = space,
): void {
  const all = read(PROJECTS)
  const out: Record<string, unknown> = {}
  let changed = false
  for (const [key, words] of Object.entries(all)) {
    const path = key.startsWith(`${space}/`) ? key.slice(space.length + 1) : null
    const now = path === null ? null : moved(path)
    const stays = now === path && into === space
    if (path === null || now === null || stays || typeof words !== 'string') {
      out[key] = words
      continue
    }
    out[`${into}/${now}`] = follow(words, path, now)
    changed = true
  }
  if (changed) keepJson(PROJECTS, out)
}
