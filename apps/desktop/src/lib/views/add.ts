import {
  addDays,
  type Base,
  isWhen,
  nextId,
  type Priority,
  rowsInBase,
  type Value,
} from '@orden/bases'
import { noteName, plainValue, rowPlace, withProperties } from '@orden/bases/agent'
import { joinPath } from '../tauri'
import { insideOnly } from '../automation/inside'
import { folderOf, insideSpace, within } from '../space-paths'
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
import { dayIn } from './values'
import type { Only } from './display'
import type { ViewSpec } from './spec'

export interface Prefill {
  due?: string
  deadline?: string
  tags?: string[]
  priority?: Priority
  status?: string
  assignee?: string
}

export function openQuickAdd(prefill: Prefill = {}): boolean {
  if (
    prefill.priority !== undefined ||
    prefill.status !== undefined ||
    prefill.deadline !== undefined ||
    prefill.assignee !== undefined
  )
    return false
  showQuickAdd({
    ...(prefill.tags ? { tags: prefill.tags } : {}),
    ...(prefill.due ? { due: prefill.due } : {}),
  })
  return true
}

const WHEN_DAYS: Record<string, number> = { overdue: 0, today: 0, tomorrow: 1, later: 2 }

function narrowedBy(out: Prefill, only: Only, today: string) {
  if (only.label !== undefined) out.tags = [...new Set([...(out.tags ?? []), only.label])]
  if (only.priority !== undefined) out.priority = only.priority
  if (only.date === 'today' || only.date === 'week' || only.date === 'overdue') out.due = today
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
  narrowedBy(out, only, today)
  if (!group) return out

  const { property, key } = group
  if (property === 'task.priority' && isPriority(key)) out.priority = key
  else if (property === 'task.status' && typeof key === 'string') out.status = key
  else if (property === 'task.tags' && typeof key === 'string' && key) {
    out.tags = [...new Set([...(out.tags ?? []), key])]
  } else if (isWhen(property) && typeof key === 'string' && Object.hasOwn(WHEN_DAYS, key)) {
    out.deadline = addDays(today, WHEN_DAYS[key] ?? 0)
  } else if (property === 'formula.day' || /^task\.(due|date|scheduled)$/.test(property)) {
    const day = key === 'overdue' ? today : dayIn(key)
    if (day) out.due = day
  }
  return out
}

export async function addTyped(words: string, prefill: Prefill): Promise<boolean> {
  const text = words.trim()
  if (!text) return false
  const path = await rows.inbox()
  if (path === null || !canWriteAt(path)) return false
  return addTask(path, {
    text,
    ...(prefill.due ? { due: prefill.due } : {}),
    ...(prefill.deadline ? { deadline: prefill.deadline } : {}),
    ...(prefill.tags ? { tags: prefill.tags } : {}),
    ...(prefill.priority ? { priority: prefill.priority } : {}),
    ...(prefill.status ? { status: prefill.status } : {}),
    ...(prefill.assignee ? { assignee: prefill.assignee } : {}),
  })
}

export interface NewNote {
  title?: string
  properties?: Record<string, Value>
  template?: string | null
  open?: boolean
}

function idFor(base: Base, space: { name: string }): Record<string, string> {
  const id = base.orden.id
  if (!id) return {}
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
  Object.assign(props, idFor(base, space))

  const title = noteName(made.title ?? 'Untitled')
  const name = await workspace.freeNameOnDisk(dir, `${title}.md`)
  const link =
    made.template === undefined ? (view?.orden.template ?? base.orden.template) : made.template
  const template = link ? templatePath(link, space) : null
  const words = template === null ? '' : await templateWords(template, name.replace(/.md$/i, ''))
  const path = joinPath(dir, name)
  await writeFile(path, withProperties(words, props))
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  if (made.open !== false) await workspace.open(path)
  return path
}
