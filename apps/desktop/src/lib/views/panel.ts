import { answer, type Base, builtinView, type Row } from '@orden/bases'
import { contextFor } from './context'

interface Label {
  tag: string
  count: number
}

export interface PanelCounts {
  todos: number
  overdue: boolean
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

  const labels = new Map<string, number>()
  for (const row of rows) {
    if (!isOpen(row)) continue
    if (space !== undefined && row.space !== space) continue
    for (const tag of row.task?.tags ?? []) labels.set(tag, (labels.get(tag) ?? 0) + 1)
  }

  return {
    todos: every.total,
    overdue: every.groups.some((group) => group.key === 'overdue' && group.rows.length > 0),
    labels: [...labels.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  }
}
