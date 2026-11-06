import { answer, type Base, builtinView, type Row } from '@orden/bases'
import { contextFor } from './context'

interface Project {
  space: string
  path: string
  name: string
  count: number
  mtime: number
}

interface Label {
  tag: string
  count: number
}

export interface PanelCounts {
  todos: number
  overdue: boolean
  notes: Project[]
  labels: Label[]
}

let made: Base | null = null

function todos(): Base {
  made ??= builtinView('todos')
  return made
}

const isOpen = (row: Row) =>
  row.kind === 'task' && !!row.task && !row.task.done && !row.task.cancelled

export function panelCounts(
  rows: readonly Row[],
  today: string,
  space: string | undefined,
): PanelCounts {
  const context = contextFor({ rows, today, now: `${today}T00:00:00` })
  const every = answer(todos(), 0, rows, context)

  const projects = new Map<string, Project>()
  const labels = new Map<string, number>()
  for (const row of rows) {
    if (!isOpen(row)) continue
    const key = `${row.space}\n${row.path}`
    const project = projects.get(key)
    if (project) project.count++
    else {
      projects.set(key, {
        space: row.space,
        path: row.path,
        name: row.file.basename,
        count: 1,
        mtime: row.file.mtime,
      })
    }
    if (space !== undefined && row.space !== space) continue
    for (const tag of row.task?.tags ?? []) labels.set(tag, (labels.get(tag) ?? 0) + 1)
  }

  return {
    todos: every.total,
    overdue: every.groups.some((group) => group.key === 'overdue' && group.rows.length > 0),
    notes: [...projects.values()].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name)),
    labels: [...labels.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  }
}

export function openByPath(
  notes: readonly Project[],
  space: string | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const one of notes) if (one.space === space) out.set(one.path, one.count)
  return out
}
