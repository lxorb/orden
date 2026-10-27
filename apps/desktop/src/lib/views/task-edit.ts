/** A task in quick add's field and back: what the field that edits a task in a list is
 *  given (Todoist's inline editor, Ctrl+E), and the change its Save makes - the words,
 *  the day kept by the date the task is kept by, the priority, the labels, the
 *  reminders, the length and the deadline. Pure; act.ts writes it as one edit. */

import type { TaskChange, TaskRow } from '@nib/bases'
import type { Entry, Prefill } from '../quick-add/entry'
import { editedWords, shownWords, unescapedAt } from '@nib/markdown/escapes'
import { deadlineField, deadlineOf, startOf } from '@nib/markdown/task-dates'
import { changeFor } from './schedule/schedule'

/** The day the field shows as the task's date: its start, else its scheduled day. */
const dayIn = (task: TaskRow) => startOf(task, task.dueReads) ?? task.scheduled

/** The field's prefill for a task as it stands, and its description's words. */
export function prefillFor(task: TaskRow, description: string | null): Prefill {
  // Its start date and its deadline, as its space reads a `📅` (#371).
  const due = dayIn(task)
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
  // The words a reader sees, `milk $3` where the line says `milk \$3`; `changeOf`
  // writes them back keeping every escape the line had (`editedWords`). The field reads what is typed into it, and
  // the task's own words are words, not something typed: `Monday` in `Prep Monday
  // notes` is no start date, `p1` no priority. So each is kept as a word, one span a
  // word so an edit in one lets only that one be read. What the line escaped is no
  // tag either: `\#tips` was a word, never a label.
  const text = shownWords(task.text)
  const keep = [...text.matchAll(/\S+/gu)].map((one) => ({
    from: one.index,
    to: one.index + one[0].length,
  }))
  const escaped = unescapedAt(task.text).map((at) => ({ from: at, to: at + 1 }))
  return {
    text,
    ...(description ? { description } : {}),
    fields,
    ...(keep.length ? { keep } : {}),
    ...(escaped.length ? { escaped } : {}),
  }
}

/** What saving the field changes in the task: every field it holds, a field it no
 *  longer holds taken away. A low priority the field cannot show (the Tasks plugin's
 *  🔽 and ⏬) is kept unless another was picked. */
export function changeOf(task: TaskRow, entry: Entry): TaskChange {
  const fields = entry.fields
  // Against the words as the field gives them back, its blanks closed up, so words
  // left as they were write nothing, not even a double blank closed.
  const unchanged = entry.text === shownWords(task.text).replace(/\s+/gu, ' ').trim()
  const keptLow = task.priority > 4 && (fields.priority ?? 4) === 4
  // A day taken out of the field takes its time and repeat with it, as Todoist's does.
  // A task that had no day to take (a deadline alone) keeps both as the field holds them.
  const undated = (fields.due ?? null) === null && dayIn(task) === undefined
  const change: TaskChange = {
    ...(unchanged ? {} : { text: editedWords(task.text, entry.text) }),
    ...(undated
      ? { time: fields.time ?? null, recurrence: fields.recurrence ?? null }
      : changeFor(task, {
          due: fields.due ?? null,
          time: fields.time ?? null,
          recurrence: fields.recurrence ?? null,
        })),
    priority: keptLow ? task.priority : (fields.priority ?? 4),
    tags: fields.tags,
    remind: fields.remind,
    [deadlineField(task, task.dueReads)]: fields.deadline ?? null,
  }
  change.duration = fields.duration ?? null
  return change
}
