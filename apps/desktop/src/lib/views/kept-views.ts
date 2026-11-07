import { type Base, placeOfKey, readBase, writeBase } from '@orden/bases'
import { isRecord, keepJson, stored, stringList } from '../stored'
import type { ViewSpec } from './spec'

const FOLDS = 'orden:view-folds'
const PROJECTS = 'orden:project-views'
const TODOS = 'orden:todos-views'
const RENAMES = 'orden:space-renames'

export const EVERY_SPACE = ''

const MOST = 200

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

export function foldsOf(key: string | null): ReadonlySet<string> {
  if (key === null) return new Set()
  return new Set(stringList(read(FOLDS)[key]) ?? [])
}

export function keepFolds(key: string | null, folded: ReadonlySet<string>): void {
  if (key === null) return
  const all = Object.fromEntries(Object.entries(read(FOLDS)).filter(([one]) => one !== key))
  if (folded.size) all[key] = [...folded]
  const kept = Object.entries(all).slice(-MOST)
  keepJson(FOLDS, Object.fromEntries(kept))
}

export function projectView(space: string, path: string): string | undefined {
  const words = read(PROJECTS)[`${space}/${path}`]
  return typeof words === 'string' ? words : undefined
}

export function keepProjectView(space: string, path: string, words: string): void {
  const all = read(PROJECTS)
  all[`${space}/${path}`] = words
  keepJson(PROJECTS, all)
}

export function todosView(space: string): string | undefined {
  const words = read(TODOS)[space]
  return typeof words === 'string' ? words : undefined
}

export function keepTodosView(space: string, words: string | undefined): void {
  const all = Object.fromEntries(Object.entries(read(TODOS)).filter(([one]) => one !== space))
  if (words !== undefined) all[space] = words
  keepJson(TODOS, all)
}

export function takeOverTodosView(words: string): void {
  keepJson(TODOS, { [EVERY_SPACE]: words })
}

function foldOf(key: string, space: string): string | null {
  if (key === `todos:${space}`) return ''
  const project = `project:${space}/`
  return key.startsWith(project) ? key.slice(project.length) : null
}

export function followSpaceViews(
  from: string,
  to: string,
  follow: (words: string) => string,
): void {
  const todos = read(TODOS)
  const words = todos[from]
  const every = todos[EVERY_SPACE]
  if (typeof words === 'string' || typeof every === 'string') {
    const next = without(todos, (one) => one === from)
    if (typeof words === 'string') next[to] = follow(words)
    if (typeof every === 'string') next[EVERY_SPACE] = follow(every)
    keepJson(TODOS, next)
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

export function unnarrowed(words: string, space: string): string {
  let base: Base
  try {
    base = readBase(words)
  } catch {
    return words
  }
  const views = base.views.map((view) => {
    const only = view.nib.kept.only
    if (!isRecord(only)) return view
    const project = typeof only.project === 'string' ? placeOfKey(only.project).space : null
    const gone = (key: string) =>
      (key === 'space' && only.space === space) || (key === 'project' && project === space)
    if (!Object.keys(only).some(gone)) return view
    const rest = without(only, gone)
    const kept = without(view.nib.kept, (key) => key === 'only')
    return {
      ...view,
      nib: { ...view.nib, kept: Object.keys(rest).length ? { ...kept, only: rest } : kept },
    }
  })
  return views.some((view, at) => view !== base.views[at]) ? writeBase({ ...base, views }) : words
}

export function forgetSpaceViews(space: string): void {
  const todos = read(TODOS)
  const every = todos[EVERY_SPACE]
  const left = typeof every === 'string' ? unnarrowed(every, space) : every
  if (space in todos || left !== every)
    keepJson(TODOS, {
      ...without(todos, (one) => one === space),
      ...(left === every ? {} : { [EVERY_SPACE]: left }),
    })
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

export function spaceRenamed(from: string, to: string): void {
  const all = without(read(RENAMES), (key) => key === to)
  keepJson(RENAMES, { ...all, [from]: to })
}

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
