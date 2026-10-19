/** A task line drawn as its words and a row of quiet chips (docs/tasks.md 5.7).
 *
 *    ◯ Call the bank about the card   Mon 16:00 · 🔔 · ⏫
 *
 *  A task's fields are marks the way `**` is: written so another app can read them,
 *  and not what the reader wants to look at. So every field the Tasks plugin or nib
 *  writes is hidden like a mark, and comes back with the caret on its line, dimmed the
 *  way marks are; a chip after the words says what they said. Tags stay where they
 *  were written: they are words, and already wear their own pill. An inline field nib
 *  has no name for stays too, because nothing would say what it held.
 *
 *  A chip pressed opens its field's choices as the app draws them (`taskHelp.pick`),
 *  and the pick is one edit of exactly the characters that change (`writeTask`). */

import type { EditorView } from '@codemirror/view'
import { writeTask } from '@nib/markdown/task-edits'
import {
  type FieldToken,
  type ParsedTask,
  parseTask,
  type Priority,
  type TaskFields,
} from '@nib/markdown/task-line'
import { label } from '../labels'
import { dayWords, timeWords, todayHere } from '../task-days'
import { deadlineOf, type DueReads, startOf } from '@nib/markdown/task-dates'
import { noteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'

/** One chip: what it shows, and which field a press on it picks. */
export interface TaskChip {
  field:
    'date' | 'recurrence' | 'priority' | 'remind' | 'duration' | 'deadline' | 'assignee' | 'done'
  text: string
  /** `overdue` in the danger tone, `p1` to `p3` in the priorities'. */
  tone?: 'overdue' | 'p1' | 'p2' | 'p3'
}

/** The fields hidden from the line while the caret is elsewhere. */
const HIDDEN = new Set<FieldToken['field']>([
  'due',
  'scheduled',
  'start',
  'created',
  'completed',
  'cancelledOn',
  'priority',
  'recurrence',
  'onCompletion',
  'id',
  'dependsOn',
  'time',
  'duration',
  'deadline',
  'remind',
  'assignee',
])

/** The spans of a task line its fields are written in, each with the blank before it,
 *  offsets into the line. */
function fieldSpans(line: string, parsed: ParsedTask): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const token of parsed.tokens) {
    if (!HIDDEN.has(token.field)) continue
    let from = token.from
    while (from > parsed.wordsFrom && /[ \t]/.test(line.charAt(from - 1))) from--
    out.push({ from, to: token.to })
  }
  return out
}

/** A priority's chip: the Tasks plugin's own mark, in its tone; p4 has none. */
const PRIORITY: Record<Priority, Pick<TaskChip, 'text' | 'tone'> | null> = {
  1: { text: '🔺', tone: 'p1' },
  2: { text: '⏫', tone: 'p2' },
  3: { text: '🔼', tone: 'p3' },
  4: null,
  5: { text: '🔽' },
  6: { text: '⏬' },
}

const minutes = (count: number) => {
  const hours = Math.floor(count / 60)
  const rest = count % 60
  return hours ? (rest ? `${hours}h${rest}m` : `${hours}h`) : `${rest}m`
}

/** The chips a task's fields make, in the order 5.7 draws them. The day it starts is
 *  said while that is still to come and never as late; once it has come only its time
 *  is; only a deadline is late (#371). `due` is what a `📅` means in the note's space. */
export function chipsOf(fields: TaskFields, today: string, due: DueReads = 'start'): TaskChip[] {
  const day = (iso: string, time?: string) => dayWords(iso, today, time)
  const out: TaskChip[] = []
  const open = !fields.done && !fields.cancelled
  const date = startOf(fields, due) ?? fields.scheduled
  if (date !== undefined && date > today) out.push({ field: 'date', text: day(date, fields.time) })
  else if (fields.time !== undefined) out.push({ field: 'date', text: timeWords(fields.time) })
  if (fields.recurrence) out.push({ field: 'recurrence', text: `↻ ${fields.recurrence}` })
  const flag = PRIORITY[fields.priority]
  if (flag) out.push({ field: 'priority', ...flag })
  if (fields.remind.length) out.push({ field: 'remind', text: '🔔' })
  if (fields.duration !== undefined)
    out.push({ field: 'duration', text: `⏱ ${minutes(fields.duration)}` })
  const deadline = deadlineOf(fields, due)
  if (deadline !== undefined) {
    const late = open && deadline < today
    out.push({
      field: 'deadline',
      text: `⚑ ${day(deadline)}`,
      ...(late ? { tone: 'overdue' } : {}),
    })
  }
  if (fields.assignee) out.push({ field: 'assignee', text: `+${fields.assignee}` })
  if (fields.completed !== undefined) {
    out.push({ field: 'done', text: label('taskDoneOn').replace('{date}', day(fields.completed)) })
  }
  return out
}

/** The row of chips after a task's words. */
export class TaskChipsWidget extends NibWidget {
  constructor(
    private readonly chips: readonly TaskChip[],
    /** Where the task's line starts, to find it again when a chip is pressed. */
    private readonly at: number,
  ) {
    super()
  }

  override eq(other: TaskChipsWidget) {
    return other.at === this.at && JSON.stringify(other.chips) === JSON.stringify(this.chips)
  }

  toDOM(view: EditorView) {
    const row = document.createElement('span')
    row.className = 'nib-task-chips'
    for (const chip of this.chips) {
      const one = document.createElement('span')
      one.className = 'nib-task-chip'
      one.dataset.field = chip.field
      if (chip.tone) one.dataset.tone = chip.tone
      one.textContent = chip.text
      row.append(one)
    }

    const press = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-field]') : null
      const help = view.state.facet(noteIndex).tasks
      if (!(target instanceof HTMLElement) || !help || view.state.readOnly) return
      // The caret stays where it was: a press on a chip is a pick, not a place to type.
      event.preventDefault()
      const line = view.state.doc.lineAt(Math.min(this.at, view.state.doc.length))
      const parsed = parseTask(line.text)
      if (!parsed) return
      help.pick(
        target.dataset.field ?? '',
        parsed.fields,
        target.getBoundingClientRect(),
        view.state.facet(noteIndex).dueReads ?? 'start',
        (change) => {
          const now = view.state.doc.lineAt(Math.min(this.at, view.state.doc.length))
          const edits = writeTask(now.text, change)
          if (!edits.length) return
          view.dispatch({
            changes: edits.map((edit) => ({
              from: now.from + edit.from,
              to: now.from + edit.to,
              insert: edit.insert,
            })),
            userEvent: 'input',
          })
        },
      )
    }
    row.addEventListener('mousedown', press)
    this.onDestroy(row, () => row.removeEventListener('mousedown', press))
    return row
  }

  override ignoreEvent() {
    return true
  }
}

/** What a task line wants drawn: its fields hidden and the chips after it. Null for a
 *  line that is not a task. Offsets into the line. */
export function taskDrawing(
  line: string,
  due: DueReads = 'start',
): { hide: { from: number; to: number }[]; chips: TaskChip[] } | null {
  const parsed = parseTask(line)
  if (!parsed) return null
  return { hide: fieldSpans(line, parsed), chips: chipsOf(parsed.fields, todayHere(), due) }
}

/** A comment's own fields (\`[at:: 2026-10-13T09:30]\`, \`[by:: Lu]\`), written by the task
 *  view's composer under a task: hidden like a mark, and said after its words as a
 *  quiet chip - when, and by whom. Nothing to pick, so nothing to press. */
const COMMENT_FIELD = /[ \t]*\[(at|by)::[ \t]*([^\]]*?)[ \t]*\]/g

/** A list item that is a task, which draws its own fields. */
const TASK_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\]/

/** What a comment's line hides and says again, or null for a line with no such field. */
export function commentDrawing(
  line: string,
  today = todayHere(),
): { hide: { from: number; to: number }[]; chips: string[] } | null {
  if (TASK_ITEM.test(line)) return null
  const hide: { from: number; to: number }[] = []
  const chips: string[] = []
  for (const found of line.matchAll(COMMENT_FIELD)) {
    const [whole, key, value = ''] = found
    if (!value) continue
    hide.push({ from: found.index, to: found.index + whole.length })
    if (key === 'by') chips.push(value)
    else {
      const [day = '', time] = value.split('T')
      chips.push(/^\d{4}-\d{2}-\d{2}$/.test(day) ? dayWords(day, today, time?.slice(0, 5)) : value)
    }
  }
  return hide.length ? { hide, chips } : null
}

/** The when and the who after a comment's words, in the task chips' quiet ink. */
export class CommentChipsWidget extends NibWidget {
  constructor(readonly chips: readonly string[]) {
    super()
  }

  override eq(other: CommentChipsWidget) {
    return other.chips.join('\n') === this.chips.join('\n')
  }

  toDOM() {
    const row = document.createElement('span')
    row.className = 'nib-task-chips nib-comment-chips'
    for (const text of this.chips) {
      const one = document.createElement('span')
      one.className = 'nib-task-chip'
      one.textContent = text
      row.append(one)
    }
    return row
  }

  override ignoreEvent() {
    return false
  }
}
