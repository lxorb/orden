/** What the Tasks panel lists, with its counts: every space's Todos as its view answers
 *  it (#1046, #1153), then the notes (every note with open tasks, the most recently
 *  written first, which the favourites are counted by) and the labels (every tag on an
 *  open task of the open space, which is where renaming one writes).
 *
 *  Todos is counted by the engine answering the base as Orden ships it (`builtinView`):
 *  every task of every space that can be worked on, as Todoist's sidebar counts a project,
 *  whatever its view is narrowed to or shows just now. The notes and labels are one pass
 *  over the open tasks. Pure: the panel hands in the rows and the day, and draws the
 *  answer. */

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
  /** The open tasks of Todos, in every space. */
  todos: number
  /** Whether any of them are overdue, which turns the count to the danger tone. */
  overdue: boolean
  /** Every note with open tasks. */
  notes: Project[]
  labels: Label[]
}

/** Todos, made once, so the engine compiles it once and keeps what it knows about every
 *  row between two counts. */
let made: Base | null = null

function todos(): Base {
  made ??= builtinView('todos')
  return made
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

/** Open tasks per note of one space, by the note's path in it. */
export function openByPath(
  notes: readonly Project[],
  space: string | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const one of notes) if (one.space === space) out.set(one.path, one.count)
  return out
}
