import type { EditorView } from '@codemirror/view'
import { writeTask } from '@orden/markdown/task-edits'
import {
  type FieldToken,
  type ParsedTask,
  parseTask,
  type Priority,
  type TaskFields,
} from '@orden/markdown/task-line'
import { label } from '../labels'
import { dayWords, timeWords, todayHere } from '../task-days'
import { deadlineOf, type DueReads, startOf } from '@orden/markdown/task-dates'
import { noteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'

export interface TaskChip {
  field:
    'date' | 'recurrence' | 'priority' | 'remind' | 'duration' | 'deadline' | 'assignee' | 'done'
  text: string
  tone?: 'overdue' | 'p1' | 'p2' | 'p3'
}

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

export class TaskChipsWidget extends NibWidget {
  constructor(
    private readonly chips: readonly TaskChip[],
    readonly picks = true,
  ) {
    super()
  }

  override eq(other: TaskChipsWidget) {
    return other.picks === this.picks && JSON.stringify(other.chips) === JSON.stringify(this.chips)
  }

  toDOM(view: EditorView) {
    const row = document.createElement('span')
    row.className = this.picks ? 'orden-task-chips' : 'orden-task-chips orden-task-chips-still'
    for (const chip of this.chips) {
      const one = document.createElement('span')
      one.className = 'orden-task-chip'
      one.dataset.field = chip.field
      if (chip.tone) one.dataset.tone = chip.tone
      one.textContent = chip.text
      row.append(one)
    }

    const press = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-field]') : null
      const help = view.state.facet(noteIndex).tasks
      if (!(target instanceof HTMLElement) || !help || view.state.readOnly) return
      event.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(row))
      const parsed = parseTask(line.text)
      if (!parsed) return
      help.pick(
        target.dataset.field ?? '',
        parsed.fields,
        target.getBoundingClientRect(),
        view.state.facet(noteIndex).dueReads ?? 'start',
        (change) => {
          if (!row.isConnected) return
          const now = view.state.doc.lineAt(view.posAtDOM(row))
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

export function taskDrawing(
  line: string,
  due: DueReads = 'start',
): { hide: { from: number; to: number }[]; chips: TaskChip[] } | null {
  const parsed = parseTask(line)
  if (!parsed) return null
  return { hide: fieldSpans(line, parsed), chips: chipsOf(parsed.fields, todayHere(), due) }
}

const COMMENT_FIELD = /[ \t]*\[(at|by)::[ \t]*([^\]]*?)[ \t]*\]/g

const TASK_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\]/

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

export class CommentChipsWidget extends NibWidget {
  constructor(readonly chips: readonly string[]) {
    super()
  }

  override eq(other: CommentChipsWidget) {
    return other.chips.join('\n') === this.chips.join('\n')
  }

  toDOM() {
    const row = document.createElement('span')
    row.className = 'orden-task-chips orden-comment-chips'
    for (const text of this.chips) {
      const one = document.createElement('span')
      one.className = 'orden-task-chip'
      one.textContent = text
      row.append(one)
    }
    return row
  }

  override ignoreEvent() {
    return false
  }
}
