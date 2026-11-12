import { csvText, type Row } from '@orden/bases'
import { deadlineOf, startOf } from '@orden/markdown/task-dates'
import { deliver } from '../export/save'
import { rows as store } from '../rows/rows.svelte'
import { relativeTo, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText } from '../workspace/note-text'
import { commentsOf, descriptionOf } from './task-body'

const HEADER = [
  'TYPE',
  'CONTENT',
  'DESCRIPTION',
  'PRIORITY',
  'INDENT',
  'AUTHOR',
  'RESPONSIBLE',
  'DATE',
  'DATE_LANG',
  'TIMEZONE',
  'DURATION',
  'DURATION_UNIT',
  'DEADLINE',
  'DEADLINE_LANG',
]

function line(fields: Partial<Record<(typeof HEADER)[number], string>>): string[] {
  return HEADER.map((name) => fields[name] ?? '')
}

export function todoistCsv(tasks: readonly Row[], text: string): string {
  const ordered = [...tasks]
    .filter((row) => row.task && row.anchor)
    .sort((a, b) => (a.anchor?.line ?? 0) - (b.anchor?.line ?? 0))
  const depth = new Map<number, number>()
  const out: string[][] = []
  let section: string | undefined
  for (const row of ordered) {
    const task = row.task
    const anchor = row.anchor
    const at = anchor?.line
    if (!task || !anchor || at === undefined) continue
    const parent = task.parent === undefined ? undefined : depth.get(task.parent)
    const level = parent === undefined ? 1 : parent + 1
    depth.set(at, level)
    const heading = task.section.at(-1)
    if (
      level === 1 &&
      heading !== undefined &&
      heading !== section &&
      heading !== row.file.basename
    ) {
      out.push(line({ TYPE: 'section', CONTENT: heading }))
    }
    if (level === 1) section = heading
    const labels = task.tags.filter((tag) => !task.text.includes(`#${tag}`))
    const day = startOf(task, task.dueReads) ?? task.scheduled
    const deadline = deadlineOf(task, task.dueReads)
    out.push(
      line({
        TYPE: 'task',
        CONTENT: [task.text, ...labels.map((tag) => `@${tag}`)].join(' '),
        DESCRIPTION: descriptionOf(text, anchor)?.text ?? task.description ?? '',
        PRIORITY: String(Math.min(Math.max(task.priority, 1), 4)),
        INDENT: String(level),
        DATE: task.recurrence ?? (day ? `${day}${task.time ? ` ${task.time}` : ''}` : ''),
        DATE_LANG: day || task.recurrence ? 'en' : '',
        DURATION: task.duration === undefined ? '' : String(task.duration),
        DURATION_UNIT: task.duration === undefined ? '' : 'minute',
        DEADLINE: deadline ?? '',
        DEADLINE_LANG: deadline ? 'en' : '',
      }),
    )
    for (const comment of commentsOf(text, anchor)) {
      out.push(line({ TYPE: 'note', CONTENT: comment.text }))
    }
  }
  return csvText(HEADER, out)
}

export async function saveProjectCsv(note: string, name: string): Promise<void> {
  const space = workspace.activeSpace
  if (!space) return
  const relative = relativeTo(space.root, note)
  const tasks = store.of(space.name).filter((row) => row.task && samePath(row.path, relative))
  const text = (await noteText(workspace, note)) ?? ''
  const csv = todoistCsv(tasks, text)
  await deliver(name, 'csv', 'Spreadsheet', { text: csv, mime: 'text/csv' })
}
