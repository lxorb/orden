import type { TaskChange, TaskRow } from '@orden/bases'
import type { Entry, Prefill } from '../quick-add/entry'
import { editedWords, shownWords, unescapedAt } from '@orden/markdown/escapes'
import { deadlineField, deadlineOf, startOf } from '@orden/markdown/task-dates'
import { changeFor } from './schedule/schedule'

export function prefillFor(task: TaskRow, description: string | null): Prefill {
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
  if (task.duration !== undefined) fields.duration = task.duration
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

export function changeOf(task: TaskRow, entry: Entry): TaskChange {
  const fields = entry.fields
  const unchanged = entry.text === shownWords(task.text).replace(/\s+/gu, ' ').trim()
  const keptLow = task.priority > 4 && (fields.priority ?? 4) === 4
  const change: TaskChange = {
    ...(unchanged ? {} : { text: editedWords(task.text, entry.text) }),
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
