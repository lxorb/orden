import { parseRule, ruleText } from '@orden/bases'
import { taskLine } from '@orden/markdown/task-edits'
import { NO_PRIORITY, type Priority, type Remind, type TaskFields } from '@orden/markdown/task-line'
import { asWords, OPENS_MARKUP } from '@orden/markdown/words'
import { key } from '../i18n.svelte'
import { readCsv } from './csv'
import { dayOf } from './meta'
import { safeName } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

interface Project {
  id: string
  name: string
  parent?: string
  inbox: boolean
  about?: string[]
}

interface Section {
  id: string
  project: string
  name: string
  order: number
  about?: string[]
}

interface Comment {
  text: string
  at?: string
}

interface Task {
  id: string
  project: string
  section?: string
  parent?: string
  text: string
  description: string
  priority: Priority
  due?: string
  time?: string
  zone?: string
  repeats?: string
  deadline?: string
  duration?: number
  labels: string[]
  order: number
  done?: string
  assignee?: string
  remind: Remind[]
  comments: Comment[]
}

export interface Account {
  projects: Project[]
  sections: Section[]
  tasks: Task[]
}

export function tagOf(label: string): string {
  return label
    .trim()
    .replace(/^[@#]/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}_/-]/gu, '')
}

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
  const time = task.time ?? (rule && task.repeats ? clockOf(task.repeats).time : undefined)
  const { duration } = task

  const fields: TaskFields = {
    text: asWords(oneLine(task.text)).replace(/(^|\s)@([\p{L}\p{N}_/-]+)/gu, '$1#$2'),
    status: task.done ? 'x' : ' ',
    done: !!task.done,
    cancelled: false,
    remind: task.remind,
    priority: task.priority,
    tags: task.labels.map(tagOf).filter(Boolean),
    dependsOn: [],
    fields: {},
    ...(task.due ? { start: task.due } : {}),
    ...(time ? { time } : {}),
    ...(task.zone ? { zone: task.zone } : {}),
    ...(rule ? { recurrence: rule } : {}),
    ...(task.deadline ? { deadline: task.deadline } : {}),
    ...(duration ? { duration } : {}),
    ...(task.assignee ? { assignee: asWords(task.assignee) } : {}),
    ...(task.done ? { completed: task.done } : {}),
  }
  const under = `${pad}  `
  const lines = [taskLine(fields, `${pad}- `)]
  for (const line of task.description.split(/\r?\n/))
    if (line.trim()) lines.push(`${under}${inert(line.trimEnd())}`)
  if (task.repeats && !rule) lines.push(`${under}Todoist: ${asWords(task.repeats)}`)
  for (const comment of task.comments) {
    const [first = '', ...rest] = comment.text.split(/\r?\n/)
    lines.push(`${under}${comment.at ? `${comment.at}: ` : ''}${inert(first.trimEnd())}`)
    for (const line of rest) if (line.trim()) lines.push(`${under}${inert(line.trimEnd())}`)
  }
  for (const child of children.get(task.id) ?? [])
    lines.push(...linesOf(child, children, depth + 1, kept))
  return lines
}

const oneLine = (said: string) => said.replace(/\s*[\r\n]+\s*/g, ' ').trim()

const inert = (line: string) =>
  wordsOf(line).replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\]/, '$1\\[$2]')

function wordsOf(line: string): string {
  let out = ''
  let at = 0
  for (const found of line.matchAll(ANGLED_LINK)) {
    out += `${asWords(line.slice(at, found.index))}[${asWords(found[1] ?? '')}](<${found[2]}>)`
    at = found.index + found[0].length
  }
  return out + asWords(line.slice(at))
}

const ANGLED_LINK = /\[((?:\\.|[^\\[\]\n])*)\]\(<([^<>\n]*)>\)/g

function aboutLines(about: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const one of about ?? []) {
    if (!one.trim()) continue
    if (out.length) out.push('')
    out.push(one.replace(/\r\n?/g, '\n').trim())
  }
  return out.length ? out.join('\n').split('\n').map(inert) : []
}

interface Kept {
  words: number
  written: Set<Task>
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order

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
    const gathered = children.get(task.parent)
    if (gathered) gathered.push(task)
    else children.set(task.parent, [task])
  }
  for (const list of children.values()) list.sort(byOrder)
  const byId = new Map(account.tasks.map((one) => [one.id, one]))
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
    if (lines[0]?.startsWith('---')) lines.unshift('')
    for (const task of own.filter(
      (one) => !one.section || !sections.some((section) => section.id === one.section),
    )) {
      lines.push(...linesOf(task, children, 0, kept))
    }
    for (const section of sections) {
      if (lines.length && lines.at(-1) !== '') lines.push('')
      lines.push(`## ${asWords(oneLine(section.name))}`, '')
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

const ELSEWHERE = '\0elsewhere'

const HEADER = ['TYPE', 'CONTENT', 'DESCRIPTION', 'PRIORITY', 'INDENT']

export function isTodoistCsv(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const columns = first.split(',').map((one) => one.trim().replace(/^"|"$/g, '').toUpperCase())
  return HEADER.every((name, at) => columns[at] === name)
}

function csvDate(said: string): { due: string; time?: string } | null {
  const found = /^((\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{1,2}):(\d{2}))?/.exec(said.trim())
  if (!found?.[1]) return null
  const day = new Date(Date.UTC(Number(found[2]), Number(found[3]) - 1, Number(found[4])))
  if (day.toISOString().slice(0, 10) !== found[1]) return null
  const due = found[1]
  const [hour, minute] = [found[5], found[6]]
  return hour && Number(hour) < 24 && Number(minute) < 60
    ? { due, time: `${hour.padStart(2, '0')}:${minute ?? '00'}` }
    : { due }
}

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

function linkTo(file: Json): string {
  const url = text(file.file_url) || text(file.url)
  if (!url) return ''
  const name = text(file.file_name) || text(file.title) || url
  const target = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url
  return `[${name.replace(LITERAL, '\\$&')}](${target})`
}

const LITERAL = new RegExp(`\\\\(?!\\\\*${OPENS_MARKUP.source})|[[\\]]`, 'g')

const personOf = (said: string) => said.replace(/\s*\(\d+\)\s*$/, '').trim()

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

const API = 'https://api.todoist.com/api/v1'

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

async function pages(get: Fetch, token: string, path: string, list = 'results'): Promise<Json[]> {
  const out: Json[] = []
  let cursor: string | null = null
  for (let page = 0; page < 500; page++) {
    const join = path.includes('?') ? '&' : '?'
    const url = `${API}${path}${join}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await get(url, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401 || response.status === 403) throw new Error(REFUSED)
    if (!response.ok) throw new Error(UNREACHABLE)
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
    const local = wallClock(new Date(date), zone)
    if (local) return { due: local.day, time: local.time, zone, ...repeats }
  }
  return { due: day, time: `${clock[1]}:${clock[2]}`, ...repeats }
}

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
    return null
  }
}

function taskOf(
  row: Json,
  people: ReadonlyMap<string, string>,
  remind: Remind[],
  comments: Comment[],
  finished = false,
): Task {
  const priority = Number(row.priority)
  const deadline = isRecord(row.deadline) ? text(row.deadline.date).slice(0, 10) : ''
  const duration = isRecord(row.duration)
    ? Number(row.duration.amount) * (text(row.duration.unit) === 'day' ? 1440 : 1)
    : 0
  const assignee = people.get(id(row.responsible_uid))
  const done = dayOf(text(row.completed_at))
  return {
    id: id(row.id),
    project: id(row.project_id),
    ...(id(row.section_id) ? { section: id(row.section_id) } : {}),
    ...(id(row.parent_id) ? { parent: id(row.parent_id) } : {}),
    text: text(row.content),
    description: text(row.description),
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

function commentOf(row: Json): Comment {
  const file = isRecord(row.file_attachment) ? linkTo(row.file_attachment) : ''
  const link = file ? ` ${file}` : ''
  const at = dayOf(text(row.posted_at))
  return { text: `${text(row.content)}${link}`.trim(), ...(at ? { at } : {}) }
}

export interface ApiOptions {
  completed?: boolean
  now?: Date
}

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
    if (one) {
      const gathered = remindOfTask.get(id(row.item_id))
      if (gathered) gathered.push(one)
      else remindOfTask.set(id(row.item_id), [one])
    }
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
