/** A task in quick add's field and back: what the field that edits a task in a list is
 *  given (Todoist's inline editor, Ctrl+E), and the change its Save makes - the words,
 *  the day kept by the date the task is kept by, the priority, the labels, the
 *  reminders, the length and the deadline. Pure; act.ts writes it as one edit. */

import type { TaskChange, TaskRow } from '@nib/bases'
import type { Entry, Prefill } from '../quick-add/entry'
import { deadlineField, deadlineOf, startOf } from '@nib/markdown/task-dates'
import { changeFor } from './schedule/schedule'

/** The field's prefill for a task as it stands, and its description's words. */
export function prefillFor(task: TaskRow, description: string | null): Prefill {
  // Its start date and its deadline, as its space reads a `📅` (#371).
  const due = startOf(task, task.dueReads) ?? task.scheduled
  const deadline = deadlineOf(task, task.dueReads)
  const fields: NonNullable<Prefill['fields']> = {
    ...(due === undefined ? {} : { due }),
    ...(task.time === undefined ? {} : { time: task.time }),
    ...(task.recurrence === undefined ? {} : { recurrence: task.recurrence }),
    ...(deadline === undefined ? {} : { deadline }),
    priority: task.priority <= 4 ? task.priority : 4,
    tags: [...task.tags],
    remind: [...task.remind],
  }
  // Set rather than spread in: a length here is minutes of work, not of motion.
  if (task.duration !== undefined) fields.duration = task.duration
  return { text: task.text, ...(description ? { description } : {}), fields }
}

/** What saving the field changes in the task: every field it holds, a field it no
 *  longer holds taken away. A low priority the field cannot show (the Tasks plugin's
 *  🔽 and ⏬) is kept unless another was picked. */
export function changeOf(task: TaskRow, entry: Entry): TaskChange {
  const fields = entry.fields
  const keptLow = task.priority > 4 && (fields.priority ?? 4) === 4
  const change: TaskChange = {
    ...(entry.text === task.text ? {} : { text: entry.text }),
    ...changeFor(task, {
      due: fields.due ?? null,
      time: fields.time ?? null,
      recurrence: fields.recurrence ?? null,
    }),
    priority: keptLow ? task.priority : (fields.priority ?? 4),
    tags: fields.tags,
    remind: fields.remind,
    [deadlineField(task, task.dueReads)]: fields.deadline ?? null,
  }
  change.duration = fields.duration ?? null
  return change
}
