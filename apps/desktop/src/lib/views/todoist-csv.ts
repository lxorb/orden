/** A project written out as Todoist writes one (docs/tasks.md 5.17): the CSV Todoist
 *  imports into a project and exports from one, so a project made here can be taken to
 *  Todoist, shared as a template, and brought back by nib's own importer unchanged.
 *
 *  A section a `section` row, a task a `task` row indented as deep as it sits, its labels
 *  `@label` in its words, its priority as people count it, its day (or its repeat in
 *  words), its duration and its deadline, and each comment a `note` row under it. Pure,
 *  but for `saveProjectCsv`, which reads the note and hands the file over. */

import { csvText, type Row } from '@nib/bases'
import { deadlineOf, startOf } from '@nib/markdown/task-dates'
import { deliver } from '../export/save'
import { t } from '../i18n.svelte'
import { rows as store } from '../rows/rows.svelte'
import { relativeTo, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText } from '../workspace/note-text'
import { commentsOf } from './task-body'

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

/** A row of the CSV, its columns by name. */
function line(fields: Partial<Record<(typeof HEADER)[number], string>>): string[] {
  return HEADER.map((name) => fields[name] ?? '')
}

/** A note's tasks, in the order they are written, as Todoist's CSV. `comments` answers
 *  the words of the comments under the task on a line. */
export function todoistCsv(tasks: readonly Row[], comments: (line: number) => string[]): string {
  const ordered = [...tasks]
    .filter((row) => row.task && row.anchor)
    .sort((a, b) => (a.anchor?.line ?? 0) - (b.anchor?.line ?? 0))
  const depth = new Map<number, number>()
  const out: string[][] = []
  let section: string | undefined
  for (const row of ordered) {
    const task = row.task
    const at = row.anchor?.line
    if (!task || at === undefined) continue
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
    // Todoist's date is the day a task starts; its deadline is ours (#371).
    const day = startOf(task, task.dueReads) ?? task.scheduled
    const deadline = deadlineOf(task, task.dueReads)
    out.push(
      line({
        TYPE: 'task',
        CONTENT: [task.text, ...labels.map((tag) => `@${tag}`)].join(' '),
        DESCRIPTION: task.description ?? '',
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
    for (const words of comments(at)) out.push(line({ TYPE: 'note', CONTENT: words }))
  }
  return csvText(HEADER, out)
}

/** A project's note (on this disk) saved as Todoist's CSV, named as the project is. */
export async function saveProjectCsv(note: string, name: string): Promise<void> {
  const space = workspace.activeSpace
  if (!space) return
  const relative = relativeTo(space.root, note)
  const tasks = store.of(space.name).filter((row) => row.task && samePath(row.path, relative))
  const text = (await noteText(workspace, note)) ?? ''
  const csv = todoistCsv(tasks, (line) => {
    const row = tasks.find((one) => one.anchor?.line === line)
    return row?.anchor ? commentsOf(text, row.anchor).map((one) => one.text) : []
  })
  await deliver(name, 'csv', t('Spreadsheet'), { text: csv, mime: 'text/csv' })
}
