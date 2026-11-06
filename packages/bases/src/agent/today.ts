import { dayOf, deadlineOf, hasStarted, isLate, startOf } from '@orden/markdown/task-dates'
import type { Row } from '../types'

function onToday(row: Row, today: string, undated: boolean): boolean {
  const task = row.task
  if (row.kind !== 'task' || !task || task.done || task.cancelled) return false
  if (!hasStarted(task, today, task.dueReads)) return false
  if (undated && startOf(task, task.dueReads) === undefined && task.scheduled === undefined) {
    return true
  }
  const day = dayOf(task, task.dueReads)
  const deadline = deadlineOf(task, task.dueReads)
  return (day !== undefined && day <= today) || (deadline !== undefined && deadline <= today)
}

const overdue = (row: Row, today: string) =>
  row.task !== undefined && isLate(row.task, today, row.task.dueReads)

export function todayTasks(rows: readonly Row[], today: string, undated = false): Row[] {
  return rows
    .filter((row) => onToday(row, today, undated))
    .map((row, at) => ({ row, at, late: overdue(row, today) }))
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        (a.row.task?.priority ?? 4) - (b.row.task?.priority ?? 4) ||
        timeOrder(a.row.task?.time, b.row.task?.time) ||
        a.at - b.at,
    )
    .map((one) => one.row)
}

function timeOrder(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a < b ? -1 : 1
}
