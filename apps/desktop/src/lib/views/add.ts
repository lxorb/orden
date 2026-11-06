import {
  addDays,
  type Base,
  isWhen,
  nextId,
  placeOfKey,
  type Priority,
  rowsInBase,
  type Value,
} from '@orden/bases'
import { noteName, plainValue, rowPlace, withProperties } from '@orden/bases/agent'
import { joinPath } from '../tauri'
import { insideOnly } from '../automation/inside'
import { folderOf, insideSpace, within, withinSpace } from '../space-paths'
import { contextFor } from './context'
import { nowHere, todayHere } from './days'
import { templatePath, templateWords } from './templates'
import { showQuickAdd } from '../surfaces.svelte'
import { rows } from '../rows/rows.svelte'
import { canWriteAt } from '../sharing.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { addTask } from './act'
import { bare, isNoteProperty } from './columns'
import { isPriority } from './drop'
import type { ViewSpec } from './spec'
import { dayIn } from './values'
import type { Only } from './display'

export interface Prefill {
  path?: string
  root?: string
  heading?: string
  due?: string
  deadline?: string
  tags?: string[]
  priority?: Priority
  status?: string
  assignee?: string
}

export function openQuickAdd(prefill: Prefill = {}): boolean {
  if (
    prefill.root !== undefined ||
    prefill.heading !== undefined ||
    prefill.priority !== undefined ||
    prefill.status !== undefined ||
    prefill.deadline !== undefined ||
    prefill.assignee !== undefined
  )
    return false
  const root = workspace.activeSpace?.root ?? null
  const note =
    prefill.path === undefined ? undefined : root === null ? null : withinSpace(root, prefill.path)
  if (note === null) return false

  showQuickAdd({
    ...(note === undefined ? {} : { note }),
    ...(prefill.tags ? { tags: prefill.tags } : {}),
    ...(prefill.due ? { due: prefill.due } : {}),
  })
  return true
}

const WHEN_DAYS: Record<string, number> = { overdue: 0, today: 0, tomorrow: 1, later: 2 }

function placed(out: Prefill, key: string, spec: ViewSpec) {
  const place = placeOfKey(key)
  const named = place.space ?? spec.space
  const [space, other] = workspace.spaces.filter((one) => one.name === named)
  if (space && !other) {
    out.path = insideSpace(space.root, place.path)
    if (place.space !== null) out.root = space.root
  }
}

function narrowedBy(out: Prefill, only: Only, today: string, spec: ViewSpec) {
  if (only.label !== undefined) out.tags = [...new Set([...(out.tags ?? []), only.label])]
  if (only.priority !== undefined) out.priority = only.priority
  if (only.date === 'today' || only.date === 'week' || only.date === 'overdue') out.due = today
  if (only.project !== undefined) placed(out, only.project, spec)
  if (only.assignee !== undefined && !only.assignee.startsWith(':')) out.assignee = only.assignee
}

export function prefillOf(
  spec: ViewSpec,
  today: string,
  group?: { property: string; key: Value },
  only: Only = {},
): Prefill {
  const out: Prefill = {}
  if (spec.builtin === 'today') out.due = today
  if (spec.builtin === 'label' && spec.tag) out.tags = [spec.tag]
  const named = spec.space ?? only.space
  if ((spec.builtin === 'todos' || spec.builtin === 'label') && named !== undefined) {
    const [space, other] = workspace.spaces.filter((one) => one.name === named)
    if (space && !other) out.root = space.root
  }
  if (spec.builtin === 'project' && spec.space !== undefined && spec.path !== undefined) {
    const space = workspace.spaces.find((one) => one.name === spec.space)
    if (space) out.path = insideSpace(space.root, spec.path)
    if (space && space.root !== workspace.activeSpace?.root) out.root = space.root
  }
  narrowedBy(out, only, today, spec)
  if (!group) return out

  const { property, key } = group
  if (property === 'task.section' && typeof key === 'string') out.heading = key
  else if (property === 'task.priority' && isPriority(key)) out.priority = key
  else if (property === 'task.status' && typeof key === 'string') out.status = key
  else if (property === 'task.tags' && typeof key === 'string' && key) {
    out.tags = [...new Set([...(out.tags ?? []), key])]
  } else if (isWhen(property) && typeof key === 'string' && Object.hasOwn(WHEN_DAYS, key)) {
    out.deadline = addDays(today, WHEN_DAYS[key] ?? 0)
  } else if (property === 'file.path' && typeof key === 'string' && key) {
    placed(out, key, spec)
  } else if (property === 'formula.day' || /^task\.(due|date|scheduled)$/.test(property)) {
    const day = key === 'overdue' ? today : dayIn(key)
    if (day) out.due = day
  }
  return out
}

export async function addTyped(words: string, prefill: Prefill): Promise<boolean> {
  const text = words.trim()
  if (!text) return false
  const path = prefill.path ?? (await rows.inbox(prefill.root))
  if (path === null || !canWriteAt(path)) return false
  return addTask(
    path,
    {
      text,
      ...(prefill.due ? { due: prefill.due } : {}),
      ...(prefill.deadline ? { deadline: prefill.deadline } : {}),
      ...(prefill.tags ? { tags: prefill.tags } : {}),
      ...(prefill.priority ? { priority: prefill.priority } : {}),
      ...(prefill.status ? { status: prefill.status } : {}),
      ...(prefill.assignee ? { assignee: prefill.assignee } : {}),
    },
    prefill.heading,
  )
}

export interface NewNote {
  title?: string
  properties?: Record<string, Value>
  template?: string | null
  open?: boolean
}

function idFor(base: Base): Record<string, string> {
  const id = base.nib.id
  const space = workspace.activeSpace
  if (!id || !space) return {}
  const mine = rows.of(space.name)
  const context = contextFor({ rows: mine, today: todayHere(), now: nowHere() })
  const own = rowsInBase(base, mine, context)
  return own.partial ? {} : { [id.property]: nextId(own.rows, id.property, id.prefix) }
}

export async function addNote(
  base: Base,
  at: number,
  file: string | null,
  group?: { property: string; key: Value },
  made: NewNote = {},
): Promise<string | null> {
  const space =
    (file === null ? null : workspace.spaces.find((one) => within(one.root, file) !== null)) ??
    workspace.activeSpace
  if (!space) return null
  const view = base.views[at]
  const place = rowPlace(base, view?.name)
  const folder =
    place.folder !== undefined && place.folder !== '' ? insideOnly(place.folder) : undefined
  if (folder === null) return null
  const dir =
    folder !== undefined ? insideSpace(space.root, folder) : file ? folderOf(file) : space.root
  if (!canWriteAt(dir)) return null

  const props: Record<string, unknown> = { ...place.properties }
  const key = group?.key
  if (
    group &&
    isNoteProperty(group.property) &&
    (typeof key === 'string' || typeof key === 'number')
  ) {
    props[bare(group.property)] = key
  }
  for (const [name, value] of Object.entries(made.properties ?? {})) props[name] = plainValue(value)
  Object.assign(props, idFor(base))

  const title = noteName(made.title ?? 'Untitled')
  const name = await workspace.freeNameOnDisk(dir, `${title}.md`)
  const link =
    made.template === undefined ? (view?.nib.template ?? base.nib.template) : made.template
  const template = link ? templatePath(link, space) : null
  const words = template === null ? '' : await templateWords(template, name.replace(/.md$/i, ''))
  const path = joinPath(dir, name)
  await writeFile(path, withProperties(words, props))
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  if (made.open !== false) await workspace.open(path)
  return path
}
