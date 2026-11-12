import type { Context, Row } from '@orden/bases'
import {
  PROTECTED,
  shutFor,
  objectIn,
  pokeNow,
  homeSpace,
  inboxText,
  writeInboxText,
  cleanPath,
  MOVED,
  remindRelisted,
  blobKey,
  describeById,
  prepareSpace,
  type Shut,
  type Env,
  type Note,
} from '../../../sync-server/src/api'
import {
  AgentError,
  clockOf,
  editedTask,
  listTasks,
  newTask,
  quickWords,
  wallClock,
  noteName,
  placedEdit,
  placeIn,
  queryBase,
  readAt,
  readBase,
  rowPlace,
  taskBlock,
  taskChange,
  taskIn,
  withProperties,
} from '@orden/bases/agent'
import { rowsOfText } from '@orden/bases/rows'
import { taskHash } from '@orden/bases'
import { ACCOUNT_INBOX, isAccountInbox, isInboxPath, meansInbox } from '@orden/bases/inbox'
import {
  CANCELLED_KEY,
  DONE_KEY,
  LIST_KEY,
  LIST_VALUE,
  STOPPED_VALUE,
  withDates,
} from '@orden/bases/todo-lists'
import { metaFromText, type ItemMeta, type MetaPatch } from '@orden/sync-core'
import { appliedEdits } from '@orden/markdown/edits'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import { taskLine } from '@orden/markdown/task-edits'
import {
  askedSpace,
  changedWhileWriting,
  marked,
  noteBody,
  noteRead,
  putNote,
  type Space,
  spaceSource,
  spacesFor,
} from './tools'
import { dated, listsBy, zoneOf } from './dated'
import type { TokenRow } from './tokens'

const MOST_READ = 2000
const AT_ONCE = 32

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

const string = { type: 'string' }

export const TASK_TOOLS = [
  {
    name: 'list_tasks',
    description:
      "To-dos in every space, or `space`: a `view` (inbox, today, upcoming, logbook, or a .base path), Todoist's `filter` language (`today & #work | overdue`, `p1`, `7 days`), or both. Each row's `at` is what update_task takes.",
    inputSchema: {
      type: 'object',
      properties: { space: string, view: string, filter: string, limit: { type: 'integer' } },
    },
  },
  {
    name: 'add_task',
    description:
      "Add a to-do line to the space's inbox, or to the to-do list `note` (one list_tasks shows) under the heading `under`. `text` may carry Tasks plugin marks (🛫 2026-10-06 the day it starts, [deadline:: 2026-10-20] its deadline, ⏫ 🔁 every week); `fields` takes what update_task does. Answers its `at`.",
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        text: string,
        fields: { type: 'object' },
        note: string,
        under: string,
      },
      required: ['space', 'text'],
    },
  },
  {
    name: 'update_task',
    description:
      'Change one to-do by its `at`. `done` ticks it, and a recurring one writes its next line (`next`). Dates are YYYY-MM-DD, `""` takes a field off, priority is 1 (p1) to 4, `move_to` {note?, under?} moves it with its sub-tasks. `todo_list` true makes the note of `at` (its path will do) a to-do list, false a note again.',
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        at: string,
        done: { type: 'boolean' },
        status: string,
        text: string,
        due: string,
        time: string,
        scheduled: string,
        start: string,
        deadline: string,
        priority: { type: 'integer' },
        recurrence: string,
        remind: string,
        duration: string,
        assignee: string,
        tags: { type: 'array', items: string },
        move_to: { type: 'object', properties: { note: string, under: string } },
        todo_list: { type: 'boolean' },
      },
      required: ['space', 'at'],
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
}

async function notesOf(env: Env, space: Space): Promise<Held[]> {
  const { results } = await env.DB.prepare(
    `select id, path, meta from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_READ)
    .all<Held>()
  return results
}

async function inboxRows(env: Env, userId: string): Promise<Row[]> {
  const home = homeSpace(await spacesFor(env, userId))
  if (!home) return []
  return rowsOfText(home.name, ACCOUNT_INBOX, await inboxText(env, userId))
}

async function inboxesFor(env: Env, userId: string): Promise<{ space: string; path: string }[]> {
  const home = homeSpace(await spacesFor(env, userId))
  return home ? [{ space: home.name, path: ACCOUNT_INBOX }] : []
}

async function rowsOf(
  env: Env,
  spaces: readonly Space[],
  shut: Shut,
  userId: string,
): Promise<{ rows: Row[]; partial: boolean }> {
  const rows: Row[] = await inboxRows(env, userId)
  let left = MOST_READ
  let partial = false
  for (const space of spaces) {
    const held = (await notesOf(env, space)).filter(
      (one) => MARKDOWN.test(one.path) && !shut(space.id, one.path),
    )
    const { listed: listedBy } = await listsBy(env, space.id)
    if (held.length > left) partial = true
    const reading = held.slice(0, Math.max(0, left))
    left -= reading.length
    for (let at = 0; at < reading.length; at += AT_ONCE) {
      const batch = reading.slice(at, at + AT_ONCE)
      const bodies = await Promise.all(batch.map((one) => noteBody(env, space.id, one.id)))
      batch.forEach((one, index) => {
        const meta = metaFromText(one.meta)
        const listed = listedBy(one.path, meta)
        const read = rowsOfText(space.name, one.path, bodies[index] ?? '')
        rows.push(...withDates(read, meta).filter((row) => listed || row.kind !== 'task'))
      })
    }
  }
  return { rows, partial }
}

interface Place {
  path: string
  made?: ItemMeta
}

const LISTED: ItemMeta = { [LIST_KEY]: LIST_VALUE }

const STOPPED: MetaPatch = { [LIST_KEY]: STOPPED_VALUE, [DONE_KEY]: null, [CANCELLED_KEY]: null }

const keyOf = (path: string) => path.normalize('NFC').toLowerCase()

async function placeNamed(env: Env, space: Writable, named: string | undefined): Promise<Place> {
  if (named === undefined) return { path: ACCOUNT_INBOX }
  const path = notePath(named)
  const { results } = await env.DB.prepare(
    `select path, meta from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_READ)
    .all<{ path: string; meta: string | null }>()
  const there = results.find((one) => keyOf(one.path) === keyOf(path))
  if (there === undefined && meansInbox(named)) return { path: ACCOUNT_INBOX }
  const lists = await listsBy(env, space.id)
  const listed = (one: { path: string; meta: string | null }) =>
    lists.listed(one.path, metaFromText(one.meta))
  if (there !== undefined) {
    if (listed(there)) return { path: there.path }
    throw new Said(
      `${there.path} is a note, not a to-do list: its checkboxes are not to-dos. Leave note out for the inbox, or name a to-do list.`,
    )
  }
  const name = path.split('/').pop() ?? path
  const list = results.find(
    (one) => listed(one) && keyOf(one.path.split('/').pop() ?? '') === keyOf(name),
  )
  if (list) return { path: list.path }
  const taken = new Set(results.map((one) => keyOf(one.path)))
  const stem = name.replace(MARKDOWN, '')
  for (let count = 1; ; count++) {
    const made = `${lists.home}/${count === 1 ? stem : `${stem} ${count}`}.md`
    if (!taken.has(keyOf(made))) return { path: made, made: LISTED }
  }
}

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

async function readOf(
  env: Env,
  space: Writable,
  path: string,
): Promise<{ note: Note | null; words: string } | null> {
  if (isAccountInbox(path)) return { note: null, words: await inboxText(env, space.me) }
  mayReach(space, path)
  const read = await noteRead(env, space.id, path)
  if (read === MOVED) throw new Moved(path)
  return read
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

const TRIES = 5

async function edits<T>(change: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await change()
    } catch (error) {
      if (!(error instanceof Moved)) throw error
      if (tries >= TRIES) throw new Said(changedWhileWriting(error.path))
    }
  }
}

async function written(
  env: Env,
  space: Writable,
  path: string,
  words: string,
  read: Note | null,
  made?: ItemMeta,
): Promise<string> {
  if (isAccountInbox(path)) {
    const put = await writeInboxText(env, space.me, words, contextNow(space.zone).today)
    if (put === null) throw new Said('The inbox holds as many to-dos as it can.')
    return ACCOUNT_INBOX
  }
  mayReach(space, path)
  const put = await putNote(env, space, path, words, undefined, read, made)
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

async function undatedInToday(env: Env, user: string): Promise<boolean> {
  const row = await env.DB.prepare('select settings from users where id = ?')
    .bind(user)
    .first<{ settings: string | null }>()
  return objectIn(row?.settings)?.undatedInToday !== false
}

async function list(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const spaces =
    args.space === undefined || args.space === null
      ? await spacesFor(env, token.user_id)
      : [await spaceOf(env, token, args, seen)]
  seen.push(...spaces)
  const view = words(args, 'view')
  const filter = words(args, 'filter')
  const { rows, partial } = await rowsOf(
    env,
    spaces,
    await shutFor(env, token.user_id),
    token.user_id,
  )
  const base =
    view && /\.base$/i.test(view)
      ? await readBaseAt(env, await spaceOf(env, token, args, seen), view)
      : null
  const names = new Set(
    rows.filter((row) => row.kind === 'note').map((row) => row.file.basename.toLowerCase()),
  )
  if (args.limit !== undefined && !(Number.isInteger(args.limit) && Number(args.limit) > 0)) {
    throw new Said('limit is a whole number of tasks, one or more.')
  }
  const answer = listTasks(
    rows,
    {
      ...(base ? { base: { base: base.base } } : view ? { view } : {}),
      ...(filter ? { filter } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      inboxes: await inboxesFor(env, token.user_id),
      ...(view?.trim().toLowerCase() === 'today' && (await undatedInToday(env, token.user_id))
        ? { undated: true }
        : {}),
      isNote: (name) => names.has(name.toLowerCase()),
    },
    contextNow(await zoneOf(env, token.user_id)),
  )
  return partial ? { ...answer, partial } : answer
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
  if (token.read_only)
    throw new Said('This token may only read. Allow writing in Orden’s settings first.')
  const space = await spaceOf(env, token, args, seen)
  if (space.role === 'read')
    throw new Said(`${space.name} was shared with you to read, not to write.`)
  return space
}

async function add(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  return addTaskTo(env, await writableSpace(env, token, args, seen), args)
}

type Writable = Pick<Space, 'id' | 'name' | 'user_id'> & { shut?: Shut; zone?: string; me: string }

async function addTaskTo(
  env: Env,
  space: Writable,
  args: Args,
): Promise<{ at: string; space: string; path: string }> {
  const read = newTask(args, quickWords(['en', 'de'], wallClock(new Date(), space.zone)))
  const { fields } = read
  const place = await placeNamed(env, space, words(args, 'note') ?? read.note)
  const path = place.path
  return await edits(async () => {
    const held = await readOf(env, space, path)
    const before = held?.words ?? ''
    const placed = placeIn(before, [taskLine(fields)], words(args, 'under') ?? read.heading)
    const landed = await written(
      env,
      space,
      path,
      appliedEdits(before, [placedEdit(placed)]),
      held?.note ?? null,
      place.made,
    )
    return {
      at: `${landed}#${placed.line}:${taskHash(fields.text)}`,
      space: space.name,
      path: landed,
    }
  })
}

const ANCHORED = /#\d+:[0-9a-z]+$/

async function listNote(
  env: Env,
  space: Writable,
  asked: string,
  listing: boolean,
): Promise<{ path: string; todo_list: boolean; space: string }> {
  const path = notePath(asked)
  mayReach(space, path)
  if (!listing && isInboxPath(path)) throw new Said(`${path} is the inbox, always a to-do list.`)
  const note = await env.DB.prepare(
    "select id from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<{ id: string }>()
  if (!note) throw new Said(`No note at ${path}.`)
  const held = await env.DB.prepare('select prepared_at from spaces where id = ?')
    .bind(space.id)
    .first<{ prepared_at: number | null }>()
  if (!held?.prepared_at) await prepareSpace(env, space.id)
  const done = await describeById(env, space.id, undefined, note.id, listing ? LISTED : STOPPED)
  if ('refused' in done.value) throw new Said(changedWhileWriting(path))
  if (done.changed) await pokeNow(env, space.id, done.cursor)
  await remindRelisted(env, space.id, done.relisted).catch(() => undefined)
  return { path, todo_list: listing, space: space.name }
}

async function update(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const space = await writableSpace(env, token, args, seen)
  const listing = typeof args.todo_list === 'boolean' ? args.todo_list : undefined
  if (listing === undefined) return await changed(env, space, args)
  const at = words(args, 'at') ?? ''
  if (!ANCHORED.test(at)) return await listNote(env, space, at, listing)
  const said = await changed(env, space, args)
  return { ...said, ...(await listNote(env, space, readAt(at).path, listing)) }
}

function daysOf(space: Writable, path: string, text: string, note: Note | null, hash: string) {
  const meta = note ? metaFromText(note.meta) : undefined
  const row = withDates(rowsOfText(space.name, path, text), meta).find(
    (one) => one.anchor?.hash === hash,
  )
  return (_: string, cancelled: boolean) =>
    (cancelled ? row?.task?.cancelledOn : row?.task?.completed) ?? undefined
}

async function changed(env: Env, space: Writable, args: Args): Promise<Args> {
  const anchor = readAt(args.at)
  const path = notePath(anchor.path)
  const done = typeof args.done === 'boolean' ? args.done : undefined
  const change = taskChange(args)
  const today = contextNow(space.zone).today
  const editing = async () => {
    const held = await readOf(env, space, path)
    if (held === null) throw new Said(`No note at ${path}.`)
    const edited = editedTask(held.words, space.name, path, anchor, change, done, today)
    const said = { at: edited.at, ...(edited.next ? { next: edited.next } : {}), space: space.name }
    return { held, edited, said }
  }
  const taken = (edited: { text: string; at: string }) => {
    const block = taskBlock(
      edited.text,
      taskIn(edited.text, space.name, path, readAt(edited.at)).anchor?.line ?? 0,
    )
    return { block, source: edited.text.slice(0, block.from) + edited.text.slice(block.to) }
  }
  const moveTo = args.move_to
  if (moveTo === undefined || moveTo === null) {
    return await edits(async () => {
      const { held, edited, said } = await editing()
      if (edited.text === held.words) return said
      await written(env, space, path, edited.text, held.note)
      if (held.note) await dated(env, space, path, held.words, edited.text, held.note, today)
      return said
    })
  }

  const target = typeof moveTo === 'object' ? (moveTo as Args) : { note: moveTo }
  const place =
    typeof target.note === 'string' && target.note.trim()
      ? await placeNamed(env, space, target.note)
      : { path }
  const into = place.path
  const under = words(target, 'under')
  const placedIn = await edits(async () => {
    const { held, edited, said } = await editing()
    const { block, source } = taken(edited)
    const there =
      into === path ? { words: source, note: held.note } : await readOf(env, space, into)
    const before = there?.words ?? ''
    const placed = placeIn(before, block.lines, under)
    const after = appliedEdits(before, [placedEdit(placed)])
    const landed = await written(env, space, into, after, there?.note ?? null, place.made)
    const hash = readAt(edited.at).hash
    const note = there?.note ?? (await readOf(env, space, into).catch(() => null))?.note
    if (note) {
      const was = into === path ? held.words : before
      const days = daysOf(space, path, held.words, held.note, hash)
      await dated(env, space, into, was, after, note, today, days)
    }
    return { said, at: `${landed}#${placed.line}:${hash}` }
  })
  if (into === path) return { ...placedIn.said, at: placedIn.at }

  const left = await edits(async () => {
    let read
    try {
      read = await editing()
    } catch (error) {
      if (error instanceof AgentError) {
        return `The task is no longer in ${path} as it was. If it was edited there, it is in both: check ${path}.`
      }
      throw error
    }
    const rest = taken(read.edited).source
    await written(env, space, path, rest, read.held.note)
    if (read.held.note) await dated(env, space, path, read.held.words, rest, read.held.note, today)
    return null
  }).catch((error: unknown) => {
    if (!(error instanceof Said)) throw error
    throw new Said(
      `The task is in ${into} now and still in ${path}: ${error.message} Take it out of ${path}, and do not move it again.`,
    )
  })
  return { ...placedIn.said, at: placedIn.at, ...(left ? { left } : {}) }
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
  const { rows, partial } = await rowsOf(env, [space], space.shut, space.me)
  const answer = queryBase(base, words(args, 'view'), rows, contextNow(space.zone))
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

  const link = base.orden.template
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
  const template = link ? ((await wordsAt(env, space, notePath(link))) ?? '') : ''
  const name = noteName(words(args, 'title') ?? 'Untitled')
  for (let counter = 1; counter < 100; counter++) {
    const file = counter === 1 ? `${name}.md` : `${name} ${counter}.md`
    const asked = folder ? `${folder}/${file}` : file
    const path = cleanPath(asked)
    if (!path) throw new Said(`${asked} is not a note path.`)
    if ((await wordsAt(env, space, path)) !== null) continue
    let landed
    try {
      landed = await written(
        env,
        space,
        path,
        withProperties(template, { ...where.properties, ...(properties as Args) }),
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

const RUNS: Record<
  string,
  (env: Env, token: TokenRow, args: Args, seen: Space[]) => Promise<unknown>
> = {
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

export async function callTaskTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Args,
): Promise<string> {
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
