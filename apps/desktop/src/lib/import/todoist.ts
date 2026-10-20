/** Todoist, brought over whole (docs/tasks.md 5.17): from the account through its API
 *  with a token the reader pastes, or from a project's CSV export and a backup's zip of
 *  them.
 *
 *  What becomes what: a project a note (a project inside another one a note in that
 *  one's folder), a section a heading, a task a line in the Tasks plugin's format with
 *  its sub-tasks indented under it, its description and comments indented under it
 *  with their dates, a label a tag, a priority its emoji (the API counts 4 as p1, which
 *  is turned round here; the CSV counts as people do), the due date and its time, a
 *  recurrence read again by the Tasks plugin's grammar (and kept as words under the
 *  task where it cannot be read), the deadline, the duration, the reminders, the
 *  assignee by name, and the Inbox the space's inbox where the space has none yet.
 *  Done tasks, when asked for, come as done lines with their dates.
 *
 *  The token is a parameter and never more: nothing here keeps it, and nothing past the
 *  read holds it. The reading is two halves, so a test hands over a recorded answer:
 *  the API's pages or the CSV become `Account`, and `planOf` writes the notes. */

import { parseRule, ruleText } from '@nib/bases'
import { taskLine } from '@nib/markdown/task-edits'
import { NO_PRIORITY, type Priority, type Remind, type TaskFields } from '@nib/markdown/task-line'
import { key } from '../i18n.svelte'
import { readCsv } from './csv'
import { safeName } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** One project, as both halves read it. */
interface Project {
  id: string
  name: string
  parent?: string
  inbox: boolean
  /** Its description and its own comments, above its tasks. */
  about?: string[]
}

interface Section {
  id: string
  project: string
  name: string
  order: number
  /** Its description and any comment under it, under its heading. */
  about?: string[]
}

interface Comment {
  text: string
  /** `YYYY-MM-DD`, where it was dated. */
  at?: string
}

interface Task {
  id: string
  project: string
  section?: string
  parent?: string
  text: string
  description: string
  /** p1 to p4, as people count. */
  priority: Priority
  due?: string
  time?: string
  zone?: string
  /** The rule as Todoist wrote it, read again on the way out. */
  repeats?: string
  deadline?: string
  /** Minutes. */
  duration?: number
  labels: string[]
  order: number
  done?: string
  assignee?: string
  remind: Remind[]
  comments: Comment[]
}

/** An account, or a set of exports, read. */
export interface Account {
  projects: Project[]
  sections: Section[]
  tasks: Task[]
}

// ---- the notes -----------------------------------------------------------------------

/** A label as a tag: what a tag may hold, spaces as dashes. */
export function tagOf(label: string): string {
  return label
    .trim()
    .replace(/^[@#]/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}_/-]/gu, '')
}

/** The time a rule is said at, `every day at 9am`, `every month @ 13:00`, as
 *  `HH:MM`, and the rule without it. */
export function clockOf(written: string): { time?: string; rest: string } {
  const found = /\s+(?:at|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?=\s|$)/i.exec(written)
  if (!found) return { rest: written }
  let hour = Number(found[1])
  const minute = Number(found[2] ?? 0)
  const half = found[3]?.toLowerCase()
  if (half === 'pm' && hour < 12) hour += 12
  if (half === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return { rest: written }
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const rest = `${written.slice(0, found.index)}${written.slice(found.index + found[0].length)}`
  return { time, rest }
}

/** Todoist's rule in the words the Tasks plugin reads, or null where it reads none:
 *  `every!` is `when done`, `every other` is every two, a workday a weekday, and the
 *  time it is said at is the task's time rather than the rule's (`clockOf`). */
export function ruleOf(written: string): string | null {
  const said = clockOf(written)
    .rest.trim()
    .toLowerCase()
    .replace(/^every other (day|week|month|year)$/, 'every 2 $1s')
    .replace(/\bevery (?:work ?day|weekday)s?\b/, 'every weekday')
    .replace(/\b(starting|from) .*$/, '')
    .trim()
  const rule = parseRule(said)
  return rule ? ruleText(rule) : null
}

/** One task's lines: the line, its description and its comments under it, then its
 *  sub-tasks, each a level further in. */
function linesOf(
  task: Task,
  children: ReadonlyMap<string, Task[]>,
  depth: number,
  kept: Kept,
): string[] {
  if (kept.written.has(task)) return []
  kept.written.add(task)
  const pad = '  '.repeat(depth)
  const rule = task.repeats ? ruleOf(task.repeats) : null
  if (task.repeats && !rule) kept.words += 1
  // A CSV's rule says its time in its words; the API's date carries it already.
  const time = task.time ?? (rule && task.repeats ? clockOf(task.repeats).time : undefined)
  // Minutes, not a transition: named so the motion scan does not take it for one.
  const { duration } = task

  const fields: TaskFields = {
    text: oneLine(task.text).replace(/(^|\s)@([\p{L}\p{N}_/-]+)/gu, '$1#$2'),
    status: task.done ? 'x' : ' ',
    done: !!task.done,
    cancelled: false,
    remind: task.remind,
    priority: task.priority,
    tags: task.labels.map(tagOf).filter(Boolean),
    dependsOn: [],
    fields: {},
    // Todoist's date is when a task is planned to start, which is a start date here;
    // its deadline is a deadline (#371).
    ...(task.due ? { start: task.due } : {}),
    ...(time ? { time } : {}),
    ...(task.zone ? { zone: task.zone } : {}),
    ...(rule ? { recurrence: rule } : {}),
    ...(task.deadline ? { deadline: task.deadline } : {}),
    ...(duration ? { duration } : {}),
    ...(task.assignee ? { assignee: task.assignee } : {}),
    ...(task.done ? { completed: task.done } : {}),
  }
  const under = `${pad}  `
  const lines = [taskLine(fields, `${pad}- `)]
  for (const line of task.description.split(/\r?\n/))
    if (line.trim()) lines.push(`${under}${inert(line.trimEnd())}`)
  if (task.repeats && !rule) lines.push(`${under}Todoist: ${task.repeats}`)
  for (const comment of task.comments) {
    const [first = '', ...rest] = comment.text.split(/\r?\n/)
    lines.push(`${under}${comment.at ? `${comment.at}: ` : ''}${inert(first.trimEnd())}`)
    for (const line of rest) if (line.trim()) lines.push(`${under}${inert(line.trimEnd())}`)
  }
  for (const child of children.get(task.id) ?? [])
    lines.push(...linesOf(child, children, depth + 1, kept))
  return lines
}

/** A task's name or a heading on the one line it has to fit on. */
const oneLine = (said: string) => said.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** A line of words that is not to be a task: a checkbox written in a description or a
 *  comment is shown as written, so no task appears that Todoist did not have. */
const inert = (line: string) => line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\]/, '$1\\[$2]')

/** What is said about a project or a section, as paragraphs under its head. */
function aboutLines(about: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const one of about ?? []) {
    if (!one.trim()) continue
    if (out.length) out.push('')
    out.push(one.replace(/\r\n?/g, '\n').trim())
  }
  return out.length ? out.join('\n').split('\n').map(inert) : []
}

/** How many rules could not be read again, which the sheet mentions, and the tasks
 *  written so far, so none is written twice. */
interface Kept {
  words: number
  written: Set<Task>
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order

/** The notes an account makes: a project a note in the space's projects folder (`into`),
 *  where the Tasks panel lists it (rows/projects.ts), and one with projects inside it a
 *  folder with its note as its namesake, the file list's own nesting; the Inbox a note
 *  at the top of the space, which becomes its inbox. */
export function planOf(account: Account, into = 'Projects'): ImportPlan & { inbox?: string } {
  const kept: Kept = { words: 0, written: new Set() }
  const projects = new Map(account.projects.map((one) => [one.id, one]))
  const parents = new Set(account.projects.flatMap((one) => (one.parent ? [one.parent] : [])))
  const folderOf = (project: Project, seen = new Set<string>()): string => {
    const parent = project.parent ? projects.get(project.parent) : undefined
    const name = safeName(project.name) || 'Todoist'
    if (!parent || seen.has(parent.id)) return name
    seen.add(project.id)
    return `${folderOf(parent, seen)}/${name}`
  }
  const pathOf = (project: Project): string => {
    const name = safeName(project.name) || 'Todoist'
    if (project.inbox) return name
    const folder = folderOf(project)
    const at = parents.has(project.id) ? `${folder}/${name}` : folder
    return into ? `${into}/${at}` : at
  }

  const children = new Map<string, Task[]>()
  for (const task of account.tasks) {
    if (!task.parent) continue
    children.set(task.parent, [...(children.get(task.parent) ?? []), task])
  }
  for (const list of children.values()) list.sort(byOrder)
  const byId = new Map(account.tasks.map((one) => [one.id, one]))
  // A task at the top: one with no parent here, or one whose parents go round in a
  // circle, which a broken answer could hold and which would otherwise be under nothing.
  const atTop = (task: Task): boolean => {
    if (!task.parent || !byId.has(task.parent)) return true
    const seen = new Set<string>()
    for (let at = byId.get(task.parent); at; at = at.parent ? byId.get(at.parent) : undefined) {
      if (at === task) return true
      if (seen.has(at.id)) return false
      seen.add(at.id)
    }
    return false
  }
  const top = account.tasks.filter(atTop).sort(byOrder)

  // A task of a project that was not read (a done task of an archived one) is kept in
  // a note of its own rather than left out.
  const elsewhere = top.filter((one) => !projects.has(one.project))
  const all: Project[] = elsewhere.length
    ? [...account.projects, { id: ELSEWHERE, name: 'Todoist', inbox: false }]
    : account.projects

  const files: Planned[] = []
  let inbox: string | undefined
  for (const project of all) {
    const own =
      project.id === ELSEWHERE ? elsewhere : top.filter((one) => one.project === project.id)
    const sections = account.sections.filter((one) => one.project === project.id).sort(byOrder)
    const lines: string[] = aboutLines(project.about)
    if (lines.length) lines.push('')
    // A description that opens with `---` is words, not the note's properties.
    if (lines[0]?.startsWith('---')) lines.unshift('')
    for (const task of own.filter(
      (one) => !one.section || !sections.some((section) => section.id === one.section),
    )) {
      lines.push(...linesOf(task, children, 0, kept))
    }
    for (const section of sections) {
      if (lines.length && lines.at(-1) !== '') lines.push('')
      lines.push(`## ${oneLine(section.name)}`, '')
      const about = aboutLines(section.about)
      if (about.length) lines.push(...about, '')
      for (const task of own.filter((one) => one.section === section.id))
        lines.push(...linesOf(task, children, 0, kept))
    }
    while (lines.at(-1) === '') lines.pop()
    const path = `${pathOf(project)}.md`
    if (project.inbox) inbox = path
    files.push({ kind: 'note', path, text: lines.length ? `${lines.join('\n')}\n` : '' })
  }

  const lost: Lost[] = kept.words ? [{ text: WORDS }] : []
  return { format: 'todoist', files, lost, ...(inbox ? { inbox } : {}) }
}

const WORDS = key('Some repeating dates stay as words under their tasks')

/** The id of the note for tasks whose project was not read. */
const ELSEWHERE = '\0elsewhere'

// ---- the CSV -------------------------------------------------------------------------

/** The columns every Todoist CSV starts with, which is how one is known. */
const HEADER = ['TYPE', 'CONTENT', 'DESCRIPTION', 'PRIORITY', 'INDENT']

/** Whether a file is a Todoist CSV: its header says so. */
export function isTodoistCsv(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const columns = first.split(',').map((one) => one.trim().replace(/^"|"$/g, '').toUpperCase())
  return HEADER.every((name, at) => columns[at] === name)
}

/** A date as a CSV writes it, where it is a date: `2026-10-06`, `2026-10-06 16:00`. */
function csvDate(said: string): { due: string; time?: string } | null {
  const found = /^((\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{1,2}):(\d{2}))?/.exec(said.trim())
  if (!found?.[1]) return null
  // A day the calendar has, or the words are kept as they were written.
  const day = new Date(Date.UTC(Number(found[2]), Number(found[3]) - 1, Number(found[4])))
  if (day.toISOString().slice(0, 10) !== found[1]) return null
  const due = found[1]
  const [hour, minute] = [found[5], found[6]]
  return hour && Number(hour) < 24 && Number(minute) < 60
    ? { due, time: `${hour.padStart(2, '0')}:${minute ?? '00'}` }
    : { due }
}

/** A CSV's comment, where it holds an attachment as Todoist writes one, `[[file
 *  {"file_name": ..., "file_url": ...}]]`, with a link to the file in its place. */
function attachmentsIn(said: string): string {
  return said.replace(/\[\[file\s+(\{.*?\})\]\]/gs, (whole, json: string) => {
    try {
      const file: unknown = JSON.parse(json)
      return isRecord(file) ? linkTo(file) || whole : whole
    } catch {
      return whole
    }
  })
}

/** A link to an attachment Todoist keeps: its file, or the page it is of. */
function linkTo(file: Json): string {
  const url = text(file.file_url) || text(file.url)
  if (!url) return ''
  const name = text(file.file_name) || text(file.title) || url
  const target = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url
  return `[${name.replace(/([[\]\\])/g, '\\$1')}](${target})`
}

/** A person as the CSV names one, `Lucile (14781400)`, by their name. */
const personOf = (said: string) => said.replace(/\s*\(\d+\)\s*$/, '').trim()

/** One CSV: a project. Its tasks nest by INDENT, a section starts a heading, and a
 *  note row is a comment of the task above it; one above every task is the project's
 *  own, and one under a section's row before its first task is the section's. */
export function csvProject(name: string, text: string, at: number): Account {
  const project: Project = { id: `csv-${at}`, name, inbox: /^inbox$/i.test(name), about: [] }
  const sections: Section[] = []
  const tasks: Task[] = []
  const [head = [], ...rows] = readCsv(text)
  const header = head.map((one) => one.trim().toUpperCase())
  const column = (row: readonly string[], named: string) => row[header.indexOf(named)]?.trim() ?? ''
  const open: Task[] = []
  let section: Section | undefined

  rows.forEach((row, index) => {
    const type = column(row, 'TYPE').toLowerCase()
    if (type === 'section') {
      section = {
        id: `${project.id}-s${index}`,
        project: project.id,
        name: column(row, 'CONTENT'),
        order: index,
        about: [column(row, 'DESCRIPTION')],
      }
      sections.push(section)
      open.length = 0
      return
    }
    // The project's own row, `view_style=list`, with its description where it has one.
    if (type === 'meta') project.about?.push(column(row, 'DESCRIPTION'))
    if (type === 'note') {
      const said = attachmentsIn(column(row, 'CONTENT'))
      const task = open.at(-1)
      if (task) task.comments.push({ text: said })
      else (section ?? project).about?.push(said)
      return
    }
    if (type !== 'task') return

    const indent = Math.max(1, Number(column(row, 'INDENT')) || 1)
    open.length = Math.min(open.length, indent - 1)
    const parent = open.at(-1)
    const priority = Number(column(row, 'PRIORITY'))
    const date = column(row, 'DATE')
    const when = csvDate(date)
    const duration =
      Number(column(row, 'DURATION')) *
      (column(row, 'DURATION_UNIT').toLowerCase() === 'day' ? 1440 : 1)
    const deadline = csvDate(column(row, 'DEADLINE'))
    const assignee = personOf(column(row, 'RESPONSIBLE'))
    const task: Task = {
      id: `${project.id}-t${index}`,
      project: project.id,
      ...(section ? { section: section.id } : {}),
      ...(parent ? { parent: parent.id } : {}),
      text: column(row, 'CONTENT'),
      description: column(row, 'DESCRIPTION'),
      priority: priority >= 1 && priority <= 4 ? (priority as Priority) : NO_PRIORITY,
      ...(when ?? {}),
      ...(date && !when ? { repeats: date } : {}),
      ...(deadline ? { deadline: deadline.due } : {}),
      ...(duration > 0 ? { duration } : {}),
      ...(assignee ? { assignee } : {}),
      labels: [],
      order: index,
      remind: [],
      comments: [],
    }
    tasks.push(task)
    open.push(task)
  })
  return { projects: [project], sections, tasks }
}

/** Every Todoist CSV among the files, each a project named after its file (a
 *  backup's `Work [2203306141].csv` is the project Work). */
export async function readTodoistFiles(
  sources: readonly Source[],
): Promise<ImportPlan & { inbox?: string }> {
  const account: Account = { projects: [], sections: [], tasks: [] }
  let at = 0
  for (const source of sources) {
    if (!/\.csv$/i.test(source.path)) continue
    const text = await source.text()
    if (!isTodoistCsv(text)) continue
    const name = (source.path.split('/').pop() ?? source.path)
      .replace(/\.csv$/i, '')
      .replace(/\s*\[\d+\]$/, '')
    const one = csvProject(name, text, at++)
    account.projects.push(...one.projects)
    account.sections.push(...one.sections)
    account.tasks.push(...one.tasks)
  }
  return planOf(account)
}

// ---- the API -------------------------------------------------------------------------

const API = 'https://api.todoist.com/api/v1'

/** What a fetch needs to be, so a test hands over a recorded answer. */
export type Fetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const id = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

/** Every page of one list. */
async function pages(get: Fetch, token: string, path: string, list = 'results'): Promise<Json[]> {
  const out: Json[] = []
  let cursor: string | null = null
  for (let page = 0; page < 500; page++) {
    const join = path.includes('?') ? '&' : '?'
    const url = `${API}${path}${join}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await get(url, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401 || response.status === 403) throw new Error(REFUSED)
    if (!response.ok) throw new Error(UNREACHABLE)
    // An answer that is not JSON, a proxy's page say, is no answer.
    const said: unknown = await response.json().catch(() => {
      throw new Error(UNREACHABLE)
    })
    const rows = isRecord(said) ? said[list] : null
    if (Array.isArray(rows)) out.push(...rows.filter(isRecord))
    cursor = isRecord(said) && typeof said.next_cursor === 'string' ? said.next_cursor : null
    if (!cursor) break
  }
  return out
}

const REFUSED = key('Todoist did not take that token.')
const UNREACHABLE = key('Todoist could not be reached.')

/** A due date as the API says one: the day, and the time and zone of a timed one. */
function dueOf(due: unknown): Pick<Task, 'due' | 'time' | 'zone' | 'repeats'> {
  if (!isRecord(due)) return {}
  const date = text(due.date)
  const day = date.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return {}
  const repeats = due.is_recurring === true && text(due.string) ? { repeats: text(due.string) } : {}
  const clock = /T(\d{2}):(\d{2})/.exec(date)
  if (!clock) return { due: day, ...repeats }

  const zone = text(due.timezone)
  if (date.endsWith('Z') && zone) {
    // A fixed time is said in UTC with the zone it was set in: written as that zone's
    // wall clock and the zone after it, as nib writes a time that does not float.
    const local = wallClock(new Date(date), zone)
    if (local) return { due: local.day, time: local.time, zone, ...repeats }
  }
  return { due: day, time: `${clock[1]}:${clock[2]}`, ...repeats }
}

/** A moment as a zone's wall clock, this computer's where no zone is named. */
function wallClock(moment: Date, zone?: string): { day: string; time: string } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        ...(zone ? { timeZone: zone } : {}),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(moment)
        .map((part) => [part.type, part.value]),
    )
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    }
  } catch {
    // A zone this engine does not know: the time floats instead.
    return null
  }
}

/** A task as the API answers it. */
function taskOf(
  row: Json,
  people: ReadonlyMap<string, string>,
  remind: Remind[],
  comments: Comment[],
  /** From the list of done tasks, which are done whatever else they say. */
  finished = false,
): Task {
  const priority = Number(row.priority)
  const deadline = isRecord(row.deadline) ? text(row.deadline.date).slice(0, 10) : ''
  const duration = isRecord(row.duration)
    ? Number(row.duration.amount) * (text(row.duration.unit) === 'day' ? 1440 : 1)
    : 0
  const assignee = people.get(id(row.responsible_uid))
  const done = text(row.completed_at).slice(0, 10)
  return {
    id: id(row.id),
    project: id(row.project_id),
    ...(id(row.section_id) ? { section: id(row.section_id) } : {}),
    ...(id(row.parent_id) ? { parent: id(row.parent_id) } : {}),
    text: text(row.content),
    description: text(row.description),
    // The API counts 4 as the most urgent; people count it as p1.
    priority: priority >= 1 && priority <= 4 ? ((5 - priority) as Priority) : NO_PRIORITY,
    ...dueOf(row.due),
    ...(deadline ? { deadline } : {}),
    ...(duration > 0 ? { duration } : {}),
    labels: Array.isArray(row.labels) ? row.labels.map(text).filter(Boolean) : [],
    order: Number(row.child_order) || 0,
    ...((row.checked === true || finished) && done ? { done } : {}),
    ...(assignee ? { assignee } : {}),
    remind,
    comments,
  }
}

/** A reminder as the API answers one: some minutes before, or a moment, said in UTC
 *  and written as the wall clock of its zone, or of this computer where it names none.
 *  A deleted one is none. */
function remindOf(row: Json): Remind | null {
  if (row.is_deleted === true) return null
  if (text(row.type) === 'relative' && typeof row.minute_offset === 'number')
    return { before: row.minute_offset }
  const at = isRecord(row.due) ? text(row.due.date) : ''
  const found = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at)
  if (!found?.[1] || !found[2]) return null
  const zone = isRecord(row.due) ? text(row.due.timezone) : ''
  const local = /Z$/i.test(at) ? (wallClock(new Date(at), zone) ?? wallClock(new Date(at))) : null
  return local ? { at: local.day, time: local.time } : { at: found[1], time: found[2] }
}

/** A comment, with an attachment as a link to it: a file, or the page it is of. */
function commentOf(row: Json): Comment {
  const file = isRecord(row.file_attachment) ? linkTo(row.file_attachment) : ''
  const link = file ? ` ${file}` : ''
  const at = text(row.posted_at).slice(0, 10)
  return { text: `${text(row.content)}${link}`.trim(), ...(at ? { at } : {}) }
}

export interface ApiOptions {
  /** The last three months of done tasks too, the most the API answers. */
  completed?: boolean
  now?: Date
}

/** The whole account, read once with the token handed in. */
export async function readTodoistAccount(
  get: Fetch,
  token: string,
  options: ApiOptions = {},
): Promise<Account> {
  const [projects, sections, open, reminders] = await Promise.all([
    pages(get, token, '/projects'),
    pages(get, token, '/sections'),
    pages(get, token, '/tasks'),
    pages(get, token, '/reminders').catch(() => [] as Json[]),
  ])

  let done: Json[] = []
  if (options.completed) {
    const until = options.now ?? new Date()
    const since = new Date(until.getTime() - 89 * 86_400_000)
    done = await pages(
      get,
      token,
      `/tasks/completed/by_completion_date?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`,
      'items',
    )
  }

  const people = new Map<string, string>()
  for (const project of projects.filter((one) => one.is_shared === true)) {
    for (const person of await pages(get, token, `/projects/${id(project.id)}/collaborators`).catch(
      () => [] as Json[],
    )) {
      people.set(id(person.id), text(person.name) || text(person.email))
    }
  }

  const remindOfTask = new Map<string, Remind[]>()
  for (const row of reminders) {
    const one = remindOf(row)
    if (one) remindOfTask.set(id(row.item_id), [...(remindOfTask.get(id(row.item_id)) ?? []), one])
  }

  const tasks: Task[] = []
  for (const [at, row] of [...open, ...done].entries()) {
    const comments =
      Number(row.note_count) > 0
        ? (await pages(get, token, `/comments?task_id=${encodeURIComponent(id(row.id))}`)).map(
            commentOf,
          )
        : []
    const finished = at >= open.length
    tasks.push(taskOf(row, people, remindOfTask.get(id(row.id)) ?? [], comments, finished))
  }

  return {
    projects: projects
      .filter((one) => one.is_archived !== true && one.is_deleted !== true)
      .map((one) => ({
        id: id(one.id),
        name: text(one.name),
        ...(id(one.parent_id) ? { parent: id(one.parent_id) } : {}),
        inbox: one.inbox_project === true || one.is_inbox_project === true,
        about: [text(one.description)],
      })),
    sections: sections
      .filter((one) => one.is_archived !== true && one.is_deleted !== true)
      .map((one) => ({
        id: id(one.id),
        project: id(one.project_id),
        name: text(one.name),
        order: Number(one.section_order) || 0,
      })),
    tasks,
  }
}
