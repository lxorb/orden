import { taskLine } from '@orden/markdown/task-edits'
import {
  NO_PRIORITY,
  type Priority,
  readRemind,
  readTask,
  type TaskFields,
  writeRemind,
} from '@orden/markdown/task-line'
import { taskAt } from '@orden/markdown/tasks'

export type InboxValue = string | number | boolean | null | readonly string[]

export type InboxFields = Record<string, InboxValue>

export const HEAD = 'head'

export interface Item {
  id: string
  fields: InboxFields
}

const TEXTS = [
  'due',
  'scheduled',
  'start',
  'created',
  'completed',
  'cancelledOn',
  'time',
  'zone',
  'deadline',
  'recurrence',
  'onCompletion',
  'assignee',
] as const

const text = (value: InboxValue | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const texts = (value: InboxValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

const PRIORITIES = new Set([1, 2, 3, 4, 5, 6])

const remindOf = (value: InboxValue | undefined) => {
  const said = text(value)
  return (said === undefined ? null : readRemind(said)) ?? []
}

export function fieldsOfTask(task: TaskFields, rest: string, order: number): InboxFields {
  const fields: InboxFields = {
    text: task.text,
    status: task.status,
    priority: task.priority,
    tags: [...task.tags],
    dependsOn: [...task.dependsOn],
    remind: task.remind.length ? writeRemind(task.remind) : null,
    taskId: task.id ?? null,
    extra: Object.keys(task.fields).length ? JSON.stringify(task.fields) : null,
    rest,
    order,
    block: task.block ?? null,
  }
  fields.duration = task.duration ?? null
  for (const key of TEXTS) fields[key] = task[key] ?? null
  return fields
}

function extraOf(value: InboxValue | undefined): Record<string, string> {
  if (typeof value !== 'string') return {}
  try {
    const read: unknown = JSON.parse(value)
    if (typeof read !== 'object' || read === null || Array.isArray(read)) return {}
    return Object.fromEntries(
      Object.entries(read).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

function taskOfItem(item: Item): TaskFields {
  const { fields } = item
  const status =
    typeof fields.status === 'string' && fields.status.length === 1 ? fields.status : ' '
  const priority =
    typeof fields.priority === 'number' && PRIORITIES.has(fields.priority)
      ? (fields.priority as Priority)
      : NO_PRIORITY
  const task: TaskFields = {
    text: typeof fields.text === 'string' ? fields.text : '',
    status,
    done: status === 'x' || status === 'X',
    cancelled: status === '-',
    remind: remindOf(fields.remind),
    priority,
    tags: texts(fields.tags),
    dependsOn: texts(fields.dependsOn),
    fields: extraOf(fields.extra),
  }
  const block = text(fields.block)
  if (block !== undefined) task.block = block
  for (const key of TEXTS) {
    const value = text(fields[key])
    if (value !== undefined) task[key] = value
  }
  if (typeof fields.duration === 'number') task.duration = fields.duration
  const id = text(fields.taskId)
  if (id !== undefined) task.id = id
  return task
}

const orderOf = (item: Item): number =>
  typeof item.fields.order === 'number' ? item.fields.order : 0

const live = (item: Item): boolean => item.fields.gone !== true

const byOrder = (a: Item, b: Item) =>
  orderOf(a) - orderOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const todosOf = (items: readonly Item[]): Item[] =>
  items.filter((one) => one.id !== HEAD && live(one)).sort(byOrder)

const restOf = (item: Item): string =>
  typeof item.fields.rest === 'string' ? item.fields.rest : ''

const lineOf = (item: Item): string => taskLine(taskOfItem(item))

export function rendered(items: readonly Item[]): string {
  const head = items.find((one) => one.id === HEAD && live(one))
  const lines: string[] = []
  const said = typeof head?.fields.text === 'string' ? head.fields.text : ''
  if (said !== '') lines.push(said)
  for (const item of todosOf(items)) {
    lines.push(lineOf(item))
    const rest = restOf(item)
    if (rest !== '') lines.push(rest)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

interface Block {
  task: TaskFields
  rest: string
}

export interface Read {
  head: string
  blocks: Block[]
}

export function readInbox(markdown: string): Read {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  const head: string[] = []
  const blocks: { task: TaskFields; rest: string[] }[] = []
  for (const line of lines) {
    const top = taskAt(line)
    const task = top?.indent === 0 ? readTask(line) : null
    if (task) {
      blocks.push({ task, rest: [] })
      continue
    }
    const last = blocks.at(-1)
    if (last) last.rest.push(line)
    else head.push(line)
  }
  const trimmed = (some: string[]) => some.join('\n').replace(/\n+$/, '')
  return {
    head: trimmed(head),
    blocks: blocks.map((one) => ({ task: one.task, rest: trimmed(one.rest) })),
  }
}

const same = (a: InboxValue | undefined, b: InboxValue | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface Changed {
  id: string
  fields: InboxFields
}

export function changesTo(
  items: readonly Item[],
  markdown: string,
  newId: () => string,
  shown: (id: string) => boolean,
): Changed[] {
  const held = new Map(items.filter(live).map((one) => [one.id, one]))
  const read = readInbox(markdown)
  const out: Changed[] = []
  const put = (id: string, fields: InboxFields) => {
    const was = held.get(id)?.fields ?? {}
    const differs = Object.entries(fields).filter(([key, value]) => !same(was[key], value))
    if (differs.length) out.push({ id, fields: Object.fromEntries(differs) })
  }

  const headWas = held.get(HEAD)
  if (read.head !== '' || headWas) put(HEAD, { text: read.head })

  const kept = new Set<string>([HEAD])
  const ids: (string | null)[] = read.blocks.map(() => null)
  const claim = (key: (item: Item) => unknown, wanted: (block: Block) => unknown) => {
    const free = new Map<unknown, string[]>()
    for (const item of todosOf([...held.values()])) {
      if (kept.has(item.id)) continue
      const at = key(item)
      const same = free.get(at)
      if (same) same.push(item.id)
      else free.set(at, [item.id])
    }
    read.blocks.forEach((block, index) => {
      if (ids[index] !== null) return
      const id = free.get(wanted(block))?.shift()
      if (id === undefined) return
      ids[index] = id
      kept.add(id)
    })
  }
  claim(
    (item) => `${lineOf(item)}\n${restOf(item)}`,
    (block) => `${taskLine(block.task)}\n${block.rest}`,
  )
  claim(
    (item) => item.fields.text,
    (block) => block.task.text,
  )
  const before = todosOf([...held.values()])
  read.blocks.forEach((_, index) => {
    const there = before[index]
    if (ids[index] !== null || there === undefined || kept.has(there.id)) return
    ids[index] = there.id
    kept.add(there.id)
  })
  read.blocks.forEach((block, index) => {
    const id = ids[index] ?? newId()
    kept.add(id)
    put(id, fieldsOfTask(block.task, block.rest, index))
  })
  for (const id of held.keys()) {
    if (!kept.has(id) && shown(id)) out.push({ id, fields: { gone: true } })
  }
  return out
}

const DONE = new Set(['x', 'X'])

export function datedChanges(
  held: (id: string) => InboxFields | undefined,
  changes: readonly Changed[],
  today: string,
): Changed[] {
  return changes.map((change) => {
    const was = held(change.id) ?? {}
    const status = change.fields.status ?? was.status
    const fields = { ...change.fields }
    const has = (key: string) => (key in fields ? fields[key] : was[key])
    if (typeof status === 'string' && DONE.has(status) && !has('completed')) {
      fields.completed = today
    }
    if (status === '-' && !has('cancelledOn')) fields.cancelledOn = today
    if (status === ' ' && 'status' in change.fields) {
      if (was.completed && !('completed' in change.fields)) fields.completed = null
      if (was.cancelledOn && !('cancelledOn' in change.fields)) fields.cancelledOn = null
    }
    return { id: change.id, fields }
  })
}
