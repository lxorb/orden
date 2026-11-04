/** What the Tasks panel lists, with its counts: the open space's Todos as its view
 *  answers it (#1046), then the notes (every note with open tasks, the most recently
 *  written first, which the favourites are counted by) and the labels (every tag on an
 *  open task).
 *
 *  Todos is counted by the engine answering the very base its tab opens (`builtinView`),
 *  so a number in the panel and the rows behind it can never disagree. The notes and
 *  labels are one pass over the open tasks. Pure: the panel hands in the rows and the
 *  day, and draws the answer. */

import { answer, type Base, builtinView, type Row } from '@orden/bases'
import { contextFor } from './context'

interface Project {
  space: string
  path: string
  name: string
  /** Open tasks in it. */
  count: number
  /** When it was last written, for the order. */
  mtime: number
}

interface Label {
  tag: string
  count: number
}

export interface PanelCounts {
  /** The open tasks of the space's Todos. */
  todos: number
  /** Whether any of them are overdue, which turns the count to the danger tone. */
  overdue: boolean
  /** Every note with open tasks. */
  notes: Project[]
  labels: Label[]
}

/** Each space's Todos, made once, so the engine compiles it once and keeps what it knows
 *  about every row between two counts. */
const made = new Map<string, Base>()

function todosOf(space: string | undefined): Base {
  const key = space ?? ''
  let base = made.get(key)
  if (!base) {
    base = builtinView('todos', space === undefined ? {} : { space })
    made.set(key, base)
  }
  return base
}

const isOpen = (row: Row) =>
  row.kind === 'task' && !!row.task && !row.task.done && !row.task.cancelled

/** The panel's lists and counts over these rows, on this day, for the open space. */
export function panelCounts(
  rows: readonly Row[],
  today: string,
  space: string | undefined,
): PanelCounts {
  const context = contextFor({ rows, today, now: `${today}T00:00:00` })
  const todos = answer(todosOf(space), 0, rows, context)

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
    for (const tag of row.task?.tags ?? []) labels.set(tag, (labels.get(tag) ?? 0) + 1)
  }

  return {
    todos: todos.total,
    overdue: todos.groups.some((group) => group.key === 'overdue' && group.rows.length > 0),
    notes: [...projects.values()].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name)),
    labels: [...labels.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  }
}

/** Open tasks per note of one space, by the note's path in it. */
export function openByPath(
  notes: readonly Project[],
  space: string | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const one of notes) if (one.space === space) out.set(one.path, one.count)
  return out
}
