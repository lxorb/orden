import { type Context, doneCopyId, nextRepeat, parseRule, type Row, ruleText } from '@orden/bases'
import { linkContext } from '@orden/bases/links'
import { PROTECTED, shutFor, objectIn, type Shut, type Env, type Note } from '../../../sync-server/src/api'
import { writeInbox, heldInbox, cleanPath, MOVED, blobKey } from '../../../sync-server-engine/src/api'
import {
  AgentError,
  clockOf,
  filledTemplate,
  noteName,
  queryBase,
  readBase,
  rowPlace,
  rowWords,
} from '@orden/bases/agent'
import { noteRowsOf } from '@orden/scan/rows'
import { type InboxChange, inboxFits, inboxStamp, mergedInbox, metaFromText, newer } from '@orden/sync-core'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import { askedSpace, HIDDEN, hiddenPath, marked, noteBody, putNote, type Space, spaceSource } from './tools'
import type { TokenRow } from './tokens'
import { zoneOf } from './zone'

const MOST_READ = 2000
const AT_ONCE = 32
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const string = { type: 'string' }
export const TASK_TOOLS = [
  {
    name: 'list_tasks',
    description:
      "The account's todos, open ones unless `done` is true; `label` narrows to one label. Each todo's `id` is what update_task takes.",
    inputSchema: {
      type: 'object',
      properties: {
        label: string,
        done: { type: 'boolean' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'add_task',
    description:
      'Add a todo: `title`, and optionally `description`, `labels`, `start` and `deadline` as YYYY-MM-DD, `priority` 0 (none) to 3 (high), `repeat` as a rule like "every month on the 1st" or "every! 10 days" to count from when it is done.',
    inputSchema: {
      type: 'object',
      properties: {
        title: string,
        description: string,
        labels: { type: 'array', items: string },
        start: string,
        deadline: string,
        priority: { type: 'integer' },
        repeat: string,
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description:
      'Change one todo by its `id`: `done`, `title`, `description`, `labels`, `start`, `deadline` (`""` takes a day off), `priority` 0 to 3, `repeat` (`""` stops it repeating). A repeating todo marked done moves to its next dates, and a done copy is kept.',
    inputSchema: {
      type: 'object',
      properties: {
        id: string,
        done: { type: 'boolean' },
        title: string,
        description: string,
        labels: { type: 'array', items: string },
        start: string,
        deadline: string,
        priority: { type: 'integer' },
        repeat: string,
      },
      required: ['id'],
    },
  },
  {
    name: 'query_base',
    description:
      'A view of a base as rows: its groups, the columns it shows and its summaries. `path` of a .base file, or the base as `yaml`.',
    inputSchema: {
      type: 'object',
      properties: { space: string, path: string, yaml: string, view: string },
      required: ['space'],
    },
  },
  {
    name: 'add_row',
    description:
      'Make a note as a row of a base: in the folder its filters look in, with the tags and values they ask for, from its template, then `properties`.',
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        base: string,
        view: string,
        title: string,
        properties: { type: 'object' },
      },
      required: ['space', 'base'],
    },
  },
]
type Args = Record<string, unknown>
class Said extends Error {}
const words = (args: Args, name: string): string | undefined => {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
interface Held {
  id: string
  path: string
  meta: string | null
  size: number
  updated_at: number
}
async function notesOf(env: Env, space: Space): Promise<Held[]> {
  const { results } = await env.DB.prepare(
    `select id, path, meta, size, updated_at from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_READ + 1)
    .all<Held>()
  return results
}
async function rowsOf(env: Env, spaces: readonly Space[], shut: Shut): Promise<{ rows: Row[]; partial: boolean }> {
  const rows: Row[] = []
  let left = MOST_READ
  let partial = false
  for (const space of spaces) {
    const listed = await notesOf(env, space)
    const held = listed.slice(0, MOST_READ).filter((one) => MARKDOWN.test(one.path) && !shut(space.id, one.path))
    if (listed.length > MOST_READ || held.length > left) partial = true
    const reading = held.slice(0, Math.max(0, left))
    left -= reading.length
    for (let at = 0; at < reading.length; at += AT_ONCE) {
      const batch = reading.slice(at, at + AT_ONCE)
      const bodies = await Promise.all(batch.map((one) => noteBody(env, space.id, one.id)))
      batch.forEach((one, index) => {
        const read = noteRowsOf(space.name, one.path, bodies[index] ?? '', {
          stamp: { size: one.size, mtime: one.updated_at, ctime: 0 },
          meta: metaFromText(one.meta) ?? null,
        })
        rows.push(...read.filter((row) => row.kind !== 'task'))
      })
    }
  }
  return { rows, partial }
}
type Writable = Pick<Space, 'id' | 'name' | 'user_id'> & { shut?: Shut; zone?: string; me: string }
function mayReach(space: Writable, path: string): void {
  if (space.shut?.(space.id, path)) throw new Said(PROTECTED(path))
}
async function wordsAt(env: Env, space: Writable, path: string): Promise<string | null> {
  mayReach(space, path)
  const note = await env.DB.prepare(
    "select id from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<{ id: string }>()
  return note ? noteBody(env, space.id, note.id) : null
}
async function templateAt(env: Env, space: Writable, link: string): Promise<string | null> {
  const path = notePath(link)
  const named = await wordsAt(env, space, path)
  if (named !== null) return named
  const fold = (one: string) => one.normalize('NFC').toLowerCase()
  const wanted = fold(path)
  const { results } = await env.DB.prepare(
    "select path from notes where space_id = ? and deleted = 0 and kind != 'file' order by path",
  )
    .bind(space.id)
    .all<{ path: string }>()
  const found = results.find(
    (one) => (fold(one.path) === wanted || fold(one.path).endsWith(`/${wanted}`)) && !space.shut?.(space.id, one.path),
  )
  return found ? wordsAt(env, space, found.path) : null
}
function notePath(asked: string): string {
  const named = asked.trim()
  if (isCanvasTarget(named) || isPagesTarget(named)) throw new Said(`${asked} is not a note.`)
  const path = cleanPath(MARKDOWN.test(named) ? named : `${named}.md`)
  if (!path) throw new Said(`${asked} is not a note path.`)
  return path
}
class Moved extends Error {
  constructor(readonly path: string) {
    super(`${path} moved`)
  }
}
async function written(env: Env, space: Writable, path: string, words: string, read: Note | null): Promise<string> {
  mayReach(space, path)
  const put = await putNote(env, space, path, words, undefined, read)
  if (put === MOVED) throw new Moved(path)
  if (typeof put === 'string') throw new Said(put)
  return put.path
}
function contextNow(zone: string | undefined): Context {
  return clockOf(new Date(), zone ?? 'UTC')
}
async function baseText(env: Env, space: Space, path: string): Promise<string | null> {
  const file = await env.DB.prepare(
    "select hash from notes where space_id = ? and path = ? and deleted = 0 and kind = 'file'",
  )
    .bind(space.id, path)
    .first<{ hash: string }>()
  if (!file) return null
  const object = await env.NOTES.get(blobKey(file.hash))
  return object ? object.text() : null
}
async function readBaseAt(env: Env, space: Space & Writable, asked: string) {
  const path = asked.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!/\.base$/i.test(path) || path.split('/').some((part) => !part || part === '..')) {
    throw new Said(`${asked} is not a .base file.`)
  }
  mayReach(space, path)
  const text = await baseText(env, space, path)
  if (text === null) throw new Said(`No base at ${path}.`)
  try {
    return { path, base: readBase(text) }
  } catch (error) {
    throw new Said(`${path} does not read: ${String(error)}`)
  }
}
async function spaceOf(
  env: Env,
  token: TokenRow,
  args: Args,
  seen: Space[],
): Promise<Space & { shut: Shut; zone: string; me: string }> {
  const asked = await askedSpace(env, token.user_id, args)
  if (typeof asked === 'string') throw new Said(asked)
  const [shut, zone] = await Promise.all([shutFor(env, token.user_id), zoneOf(env, token.user_id)])
  const space = { ...asked, shut, zone, me: token.user_id }
  seen.push(space)
  return space
}
async function writableSpace(
  env: Env,
  token: TokenRow,
  args: Args,
  seen: Space[],
): Promise<Space & { shut: Shut; zone: string; me: string }> {
  mayWrite(token)
  const space = await spaceOf(env, token, args, seen)
  if (space.role === 'read') throw new Said(`${space.name} was shared with you to read, not to write.`)
  return space
}
type Fields = Record<string, unknown>
interface Todo {
  id: string
  title: string
  description: string
  labels: string[]
  start: string | null
  deadline: string | null
  repeat: string | null
  priority: number
  done: boolean
  subtasks: unknown[]
  order: number
}
const DAY = /^\d{4}-\d{2}-\d{2}$/
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
function todoOf(id: string, fields: Fields): Todo | null {
  if (fields.kind !== 'todo' || fields.gone === true || typeof fields.title !== 'string') return null
  const priority = fields.priority
  return {
    id,
    title: fields.title,
    description: typeof fields.description === 'string' ? fields.description : '',
    labels: texts(fields.labels),
    start: typeof fields.start === 'string' && DAY.test(fields.start) ? fields.start : null,
    deadline: typeof fields.deadline === 'string' && DAY.test(fields.deadline) ? fields.deadline : null,
    repeat: typeof fields.repeat === 'string' && fields.repeat !== '' ? fields.repeat : null,
    priority: typeof priority === 'number' && [0, 1, 2, 3].includes(priority) ? priority : 0,
    done: fields.done === true,
    subtasks: Array.isArray(fields.subtasks) ? fields.subtasks : [],
    order: typeof fields.order === 'number' ? fields.order : 0,
  }
}
async function heldTodos(env: Env, userId: string): Promise<Map<string, Fields>> {
  const { results } = await env.DB.prepare('select id, fields from inbox_items where user_id = ? order by seq')
    .bind(userId)
    .all<{ id: string; fields: string }>()
  const out = new Map<string, Fields>()
  for (const row of results) {
    const fields = objectIn(row.fields)
    if (fields) out.set(row.id, fields)
  }
  return out
}
function dayArg(args: Args, name: string): string | null | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !DAY.test(value)) throw new Said(`${name} is a day as YYYY-MM-DD.`)
  return value
}
function patchOf(args: Args): Fields {
  const patch: Fields = {}
  const title = words(args, 'title') ?? words(args, 'text')
  if (title !== undefined) patch.title = title.slice(0, 500)
  else if (args.title !== undefined && args.title !== null) throw new Said('A todo needs a title.')
  if (typeof args.description === 'string') patch.description = args.description.slice(0, 8000)
  if (Array.isArray(args.labels)) {
    patch.labels = [
      ...new Set(
        texts(args.labels)
          .map((one) => one.trim())
          .filter(Boolean),
      ),
    ]
  }
  for (const name of ['start', 'deadline']) {
    const day = dayArg(args, name)
    if (day !== undefined) patch[name] = day
  }
  if (args.priority !== undefined) {
    if (![0, 1, 2, 3].includes(args.priority as number)) throw new Said('priority is 0, 1, 2 or 3.')
    patch.priority = args.priority
  }
  if (args.repeat !== undefined) patch.repeat = ruleArg(args.repeat)
  if (typeof args.done === 'boolean') patch.done = args.done
  return patch
}
function ruleArg(value: unknown): string | null {
  if (value === null || value === '') return null
  const rule = typeof value === 'string' ? parseRule(value) : null
  if (!rule) throw new Said('repeat is a rule like "every 3 days", or "every! 10 days" to count from when it is done.')
  return ruleText(rule)
}
const newTodoId = () => `t${crypto.randomUUID().replace(/-/g, '').slice(0, 15)}`
function undone(subtasks: unknown[]): unknown[] {
  return subtasks.map((one) => {
    if (typeof one !== 'string') return one
    const held = objectIn(one)
    return held ? JSON.stringify({ ...held, done: false }) : one
  })
}
const STAMP = /^([0-9a-z]{9})-([0-9a-z]{4})-/
function stampPast(now: string, held: string | undefined): string {
  if (!newer(held, now)) return now
  const [, time = '0', step = '0'] = STAMP.exec(held ?? '') ?? []
  const at = parseInt(time, 36)
  const next = parseInt(step, 36) + 1
  return next < 36 ** 4 ? inboxStamp(at, next, 'mcp') : inboxStamp(at + 1, 0, 'mcp')
}
async function keep(env: Env, userId: string, id: string, fields: Fields): Promise<void> {
  const held = await heldInbox(env, userId, id)
  const now = inboxStamp(Date.now(), 0, 'mcp')
  const stamps = Object.fromEntries(Object.keys(fields).map((key) => [key, stampPast(now, held?.stamps[key])]))
  const change = { id, fields: fields as InboxChange['fields'], stamps }
  if (!inboxFits({ id, ...mergedInbox(held, change) })) {
    throw new Said('That would make the todo too large for a device to read. Say it in fewer words.')
  }
  const kept = await writeInbox(env, userId, [change], 'mcp')
  if (kept === 'full') throw new Said('That is more todos than an account keeps.')
}
async function list(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  if (args.limit !== undefined && !(Number.isInteger(args.limit) && Number(args.limit) > 0)) {
    throw new Said('limit is a whole number of todos, one or more.')
  }
  const limit = typeof args.limit === 'number' ? args.limit : 50
  const label = words(args, 'label')
  const withDone = args.done === true
  const todos = [...(await heldTodos(env, token.user_id))]
    .map(([id, fields]) => todoOf(id, fields))
    .filter((one): one is Todo => one !== null)
    .filter((one) => withDone || !one.done)
    .filter((one) => label === undefined || one.labels.includes(label))
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (a.deadline === null) return 1
        if (b.deadline === null) return -1
        return a.deadline < b.deadline ? -1 : 1
      }
      return b.priority - a.priority || a.order - b.order
    })
  return { total: todos.length, todos: todos.slice(0, limit) }
}
function mayWrite(token: TokenRow): void {
  if (token.read_only) throw new Said('This token may only read. Allow writing in Orden’s settings first.')
}
async function add(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  mayWrite(token)
  const patch = patchOf(args)
  if (typeof patch.title !== 'string') throw new Said('A todo needs a title.')
  const held = await heldTodos(env, token.user_id)
  let order = 0
  for (const [id, fields] of held) {
    const one = todoOf(id, fields)
    if (one && one.order > order) order = one.order
  }
  const id = newTodoId()
  const fields: Fields = {
    kind: 'todo',
    description: '',
    labels: [],
    start: null,
    deadline: null,
    priority: 0,
    subtasks: [],
    ...patch,
    done: false,
    doneAt: null,
    order: order + 1,
    created: Date.now(),
  }
  await keep(env, token.user_id, id, fields)
  return todoOf(id, fields)
}
async function update(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  mayWrite(token)
  const id = words(args, 'id')
  if (id === undefined) throw new Said('update_task takes the id of a todo.')
  const was = (await heldTodos(env, token.user_id)).get(id)
  const before = was ? todoOf(id, was) : null
  if (!was || !before) throw new Said(`There is no todo ${id}.`)
  const patch = patchOf(args)
  if (patch.done === true && !before.done && before.repeat) {
    const today = clockOf(new Date(), await zoneOf(env, token.user_id)).today
    const next = nextRepeat({ repeat: before.repeat, start: before.start, deadline: before.deadline }, today)
    if (next) {
      await keep(env, token.user_id, doneCopyId(before, today), {
        ...was,
        done: true,
        doneAt: Date.now(),
        repeat: null,
        gone: false,
      })
      const moved: Fields = {
        ...patch,
        start: next.start,
        deadline: next.deadline,
        repeat: next.repeat,
        subtasks: undone(before.subtasks),
      }
      delete moved.done
      await keep(env, token.user_id, id, moved)
      return todoOf(id, { ...was, ...moved })
    }
  }
  if (typeof patch.done === 'boolean' && patch.done !== before.done) {
    patch.doneAt = patch.done ? Date.now() : null
  }
  if (!Object.keys(patch).length) return before
  await keep(env, token.user_id, id, patch)
  return todoOf(id, { ...was, ...patch })
}
async function query(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const space = await spaceOf(env, token, args, seen)
  const yaml = typeof args.yaml === 'string' ? args.yaml : undefined
  const path = words(args, 'path')
  let base
  if (yaml !== undefined) {
    try {
      base = readBase(yaml)
    } catch (error) {
      throw new Said(`The yaml does not read: ${String(error)}`)
    }
  } else if (path) {
    base = (await readBaseAt(env, space, path)).base
  } else {
    throw new Said('Say the path of a .base file, or the base as yaml.')
  }
  const { rows, partial } = await rowsOf(env, [space], space.shut)
  const answer = queryBase(base, words(args, 'view'), rows, {
    ...contextNow(space.zone),
    ...linkContext(rows),
  })
  return partial ? { ...answer, partial } : answer
}
async function addRow(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const space = await writableSpace(env, token, args, seen)
  const { path: basePath, base } = await readBaseAt(env, space, words(args, 'base') ?? '')
  const properties = args.properties ?? {}
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Said('properties is an object of property names and values.')
  }
  const where = rowPlace(base, words(args, 'view'))
  const folder = where.folder ?? basePath.slice(0, Math.max(0, basePath.lastIndexOf('/')))
  const template = where.template ? ((await templateAt(env, space, where.template)) ?? '') : ''
  const clock = contextNow(space.zone)
  const name = noteName(words(args, 'title') ?? 'Untitled')
  for (let counter = 1; counter < 100; counter++) {
    const title = counter === 1 ? name : `${name} ${counter}`
    const file = `${title}.md`
    const asked = folder ? `${folder}/${file}` : file
    const path = cleanPath(asked)
    if (!path) throw new Said(`${asked} is not a note path.`)
    if (hiddenPath(path)) throw new Said(HIDDEN(path))
    if ((await wordsAt(env, space, path)) !== null) continue
    let landed
    try {
      landed = await written(
        env,
        space,
        path,
        rowWords(filledTemplate(template, title, clock), where.properties, properties as Args),
        null,
      )
    } catch (error) {
      if (error instanceof Moved) continue
      throw error
    }
    return { path: landed, created: true, space: space.name }
  }
  throw new Said(`${name} is taken a hundred times over.`)
}
const RUNS: Record<string, (env: Env, token: TokenRow, args: Args, seen: Space[]) => Promise<unknown>> = {
  list_tasks: list,
  add_task: add,
  update_task: update,
  query_base: query,
  add_row: addRow,
}
function refusalOf(error: unknown): string | null {
  return error instanceof Said || error instanceof AgentError ? error.message : null
}
function sourceOf(seen: readonly Space[]): string | null {
  const sources = [...new Set(seen.map(spaceSource).filter((one) => one !== null))]
  return sources.length ? sources.join(', ') : null
}
export async function callTaskTool(env: Env, token: TokenRow, name: string, args: Args): Promise<string> {
  const run = RUNS[name]
  if (!run) return `No tool called ${name}.`
  const seen: Space[] = []
  try {
    const answer = JSON.stringify(await run(env, token, args, seen))
    return marked(sourceOf(seen), answer)
  } catch (error) {
    const said = refusalOf(error)
    if (said !== null) return marked(sourceOf(seen), said)
    throw error
  }
}
