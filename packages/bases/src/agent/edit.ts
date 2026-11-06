import { appliedEdits, type TextEdit } from '@orden/markdown/edits'
import { lastDateTaken, type TaskChange, writeTask } from '@orden/markdown/task-edits'
import { taskRowsOfText } from '../task-rows'
import { tick } from '../occurrence'
import type { Row } from '../types'
import { placedEdit, placeIn } from './entry'
import { AgentError, atOf, findTask, taskBlock } from './tasks'

function lineStart(text: string, line: number): number {
  let at = 0
  for (let index = 0; index < line; index++) {
    const next = text.indexOf('\n', at)
    if (next === -1) return text.length
    at = next + 1
  }
  return at
}

function lineAt(text: string, from: number): string {
  const end = text.indexOf('\n', from)
  return text.slice(from, end === -1 ? text.length : end).replace(/\r$/, '')
}

export function taskIn(
  text: string,
  space: string,
  path: string,
  anchor: { line: number; hash: string },
): Row {
  const found = findTask(taskRowsOfText(space, path, text), anchor)
  if (!found?.anchor)
    throw new AgentError('not_found', 'that task is not in the note any more: list_tasks again')
  return found
}

export interface Edited {
  text: string
  at: string
  next?: string
}

export function editedTask(
  text: string,
  space: string,
  path: string,
  anchor: { line: number; hash: string },
  change: TaskChange,
  done: boolean | undefined,
  today: string,
): Edited {
  const row = taskIn(text, space, path, anchor)
  const line = row.anchor?.line ?? 0
  const from = lineStart(text, line)
  const asked = (change.recurrence ?? null) !== null || (change.time ?? null) !== null
  if (asked && row.task && lastDateTaken(row.task, change)) {
    throw new AgentError(
      'bad_arguments',
      'a repeat or a time needs a date: keep one of its dates, or take recurrence and time away too',
    )
  }
  const edits: TextEdit[] = writeTask(lineAt(text, from), change).map((edit) => ({
    from: edit.from + from,
    to: edit.to + from,
    insert: edit.insert,
  }))
  let after = appliedEdits(text, edits)

  const changed = taskOn(after, space, path, line)
  if (done !== undefined && changed.task && changed.task.done !== done) {
    after = appliedEdits(after, tick(after, line, today))
  }

  const hash = changed.anchor?.hash ?? ''
  const same = taskRowsOfText(space, path, after).filter((one) => one.anchor?.hash === hash)
  const wanted = done === undefined ? same : same.filter((one) => one.task?.done === done)
  const settled = findTask(wanted.length ? wanted : same, { line, hash }) ?? changed
  const next = done
    ? same.find((one) => !one.task?.done && (one.anchor?.line ?? 0) < (settled.anchor?.line ?? 0))
    : undefined
  return { text: after, at: atOf(settled), ...(next ? { next: atOf(next) } : {}) }
}

function taskOn(text: string, space: string, path: string, line: number): Row {
  const found = taskRowsOfText(space, path, text).find(
    (one) => one.kind === 'task' && one.anchor?.line === line,
  )
  if (!found)
    throw new AgentError('not_found', 'that task is not in the note any more: list_tasks again')
  return found
}

export function movedTask(
  from: { text: string; space: string; path: string; anchor: { line: number; hash: string } },
  to: { text: string; under?: string } | null,
  under?: string,
): { source: string; target: string | null; line: number } {
  const row = taskIn(from.text, from.space, from.path, from.anchor)
  const block = taskBlock(from.text, row.anchor?.line ?? 0)
  const source = from.text.slice(0, block.from) + from.text.slice(block.to)
  const into = to === null ? source : to.text
  const placed = placeIn(into, block.lines, under ?? to?.under)
  const target = appliedEdits(into, [placedEdit(placed)])
  return to === null
    ? { source: target, target: null, line: placed.line }
    : { source, target, line: placed.line }
}
