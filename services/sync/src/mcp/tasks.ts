/** The connector's to-dos and bases: `list_tasks`, `add_task`, `update_task`,
 *  `query_base` and `add_row`, under the names and arguments `nib mcp` gives them, so
 *  a prompt written against one works against the other (docs/tasks.md 5.15).
 *
 *  What a call means is `@orden/bases/agent`, the same module the app's own verbs use,
 *  over rows read off the account's notes with Orden closed: each note's words through
 *  `rowsOfText`, the one reader of a task line there is. A change is the note written
 *  whole through `putNote`, the connector's `write_note`, so it is a version like any
 *  other and a room merges it with whoever is typing, naming the version it read: a
 *  note that moved since is read and changed again, and no word typed in between is
 *  written over (`edits`). The answers are the same JSON the app answers with, because
 *  a model reads both. Writing needs a token that may write and a space that was not
 *  shared to read. */

import type { Context, Row } from '@orden/bases'
import {
  AgentError,
  clockOf,
  editedTask,
  listTasks,
  newTask,
  quickWords,
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
import { INBOX_PATH, taskHash } from '@orden/bases'
import { meansInbox } from '@orden/bases/inbox'
import { appliedEdits } from '@orden/markdown/edits'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import { taskLine } from '@orden/markdown/task-edits'
import { objectIn } from '../body'
import { cleanPath, MOVED } from '../notes'
import { blobKey } from '../sync2/files'
import type { Env, Note } from '../types'
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
import type { TokenRow } from './tokens'

/** How many notes one call reads the words of, across every space it looks in. A list
 *  past this says it stopped looking (`partial`), the way a search does. */
const MOST_READ = 2000
/** How many bodies are asked of storage at once. */
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
      "Add a to-do line to the space's inbox, or to `note` under the heading `under`. `text` may carry Tasks plugin marks (🛫 2026-10-06 the day it starts, [deadline:: 2026-10-20] its deadline, ⏫ 🔁 every week); `fields` takes what update_task does. Answers its `at`.",
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
      'Change one to-do by its `at`. `done` ticks it, and a recurring one writes its next line (`next`). Dates are YYYY-MM-DD, `""` takes a field off, priority is 1 (p1) to 4, `move_to` {note?, under?} moves it with its sub-tasks.',
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

/** The engine's sentence, or the connector's, as what the model reads. */
class Said extends Error {}

const words = (args: Args, name: string): string | undefined => {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A note of a space as the connector has it: its row in the table and its words. */
interface Held {
  id: string
  path: string
}

/** The notes of a space, by path. */
async function notesOf(env: Env, space: Space): Promise<Held[]> {
  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_READ)
    .all<Held>()
  return results
}

/** The rows of the spaces, read a few notes at a time; `partial` where the cap was met. */
async function rowsOf(
  env: Env,
  spaces: readonly Space[],
): Promise<{ rows: Row[]; partial: boolean }> {
  const rows: Row[] = []
  let left = MOST_READ
  let partial = false
  for (const space of spaces) {
    const held = (await notesOf(env, space)).filter((one) => MARKDOWN.test(one.path))
    if (held.length > left) partial = true
    const reading = held.slice(0, Math.max(0, left))
    left -= reading.length
    for (let at = 0; at < reading.length; at += AT_ONCE) {
      const batch = reading.slice(at, at + AT_ONCE)
      const bodies = await Promise.all(batch.map((one) => noteBody(env, space.id, one.id)))
      batch.forEach((one, index) =>
        rows.push(...rowsOfText(space.name, one.path, bodies[index] ?? '')),
      )
    }
  }
  return { rows, partial }
}

/** The note a task names, or the space's inbox where it names none: "Inbox" by name
 *  too, where the space has no note called that (#1044), so no `Inbox.md` is made. */
async function placeNamed(env: Env, space: Writable, named: string | undefined): Promise<string> {
  if (named === undefined) return INBOX_PATH
  const path = notePath(named)
  if (meansInbox(named) && (await wordsAt(env, space, path)) === null) return INBOX_PATH
  return path
}

/** One note's words, or null where there is no note at that path. */
async function wordsAt(env: Env, space: Writable, path: string): Promise<string | null> {
  const note = await env.DB.prepare(
    "select id from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<{ id: string }>()
  return note ? noteBody(env, space.id, note.id) : null
}

/** A note's row and words, for a change to be written on top of. */
async function readOf(
  env: Env,
  space: Writable,
  path: string,
): Promise<{ note: Note; words: string } | null> {
  const read = await noteRead(env, space.id, path)
  if (read === MOVED) throw new Moved(path)
  return read
}

/** A note path an argument names, `.md` added where it has no ending. */
function notePath(asked: string): string {
  const named = asked.trim()
  // A canvas or a page note holds no task lines, and `.md` added to one is a new note.
  if (isCanvasTarget(named) || isPagesTarget(named)) throw new Said(`${asked} is not a note.`)
  const path = cleanPath(MARKDOWN.test(named) ? named : `${named}.md`)
  if (!path) throw new Said(`${asked} is not a note path.`)
  return path
}

/** The note at `path` moved past what was read of it. */
class Moved extends Error {
  constructor(readonly path: string) {
    super(`${path} moved`)
  }
}

/** How many times one change is read and made again on a note that keeps moving. */
const TRIES = 5

/** A change to a note, made again from a fresh read where the note moved under it, and
 *  answered in a sentence where it will not hold still. Nothing was written for a try
 *  that moved. */
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

/** Words written over `read`: what `readOf` answered for that path. Answers where the
 *  note now is, which a tree may have put elsewhere than it was asked (`putNote`). */
async function written(
  env: Env,
  space: Writable,
  path: string,
  words: string,
  read: Note | null,
): Promise<string> {
  const put = await putNote(env, space, path, words, undefined, read)
  if (put === MOVED) throw new Moved(path)
  if (typeof put === 'string') throw new Said(put)
  return put.path
}

/** What the engine is asked against. The account keeps no zone, so the day is UTC's;
 *  `nib mcp`, on the reader's machine, answers in theirs. */
function contextNow(): Context {
  return clockOf(new Date(), 'UTC')
}

/** A `.base` file's words. A base is no note to the account: it syncs as a file, its
 *  bytes kept by their hash (sync2/files.ts). */
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

async function readBaseAt(env: Env, space: Space, asked: string) {
  const path = asked.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!/\.base$/i.test(path) || path.split('/').some((part) => !part || part === '..')) {
    throw new Said(`${asked} is not a .base file.`)
  }
  const text = await baseText(env, space, path)
  if (text === null) throw new Said(`No base at ${path}.`)
  try {
    return { path, base: readBase(text) }
  } catch (error) {
    throw new Said(`${path} does not read: ${String(error)}`)
  }
}

/** Whether the account's Today holds a task with no start date, as the app's does
 *  (#408): one key out of the settings blob, read per call; off where it never said. */
async function undatedInToday(env: Env, user: string): Promise<boolean> {
  const row = await env.DB.prepare('select settings from users where id = ?')
    .bind(user)
    .first<{ settings: string | null }>()
  return objectIn(row?.settings)?.undatedInToday === true
}

async function list(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const spaces =
    args.space === undefined || args.space === null
      ? await spacesFor(env, token.user_id)
      : [await spaceOf(env, token, args, seen)]
  seen.push(...spaces)
  const view = words(args, 'view')
  const filter = words(args, 'filter')
  const { rows, partial } = await rowsOf(env, spaces)
  const base =
    view && /\.base$/i.test(view)
      ? await readBaseAt(env, await spaceOf(env, token, args, seen), view)
      : null
  const names = new Set(
    rows.filter((row) => row.kind === 'note').map((row) => row.file.basename.toLowerCase()),
  )
  // A number of tasks, from a caller a schema does not bind: below one answered none with
  // a total saying otherwise, and a fraction cut where nobody asked.
  if (args.limit !== undefined && !(Number.isInteger(args.limit) && Number(args.limit) > 0)) {
    throw new Said('limit is a whole number of tasks, one or more.')
  }
  const answer = listTasks(
    rows,
    {
      ...(base ? { base: { base: base.base } } : view ? { view } : {}),
      ...(filter ? { filter } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      inboxes: spaces.map((space) => ({ space: space.name, path: INBOX_PATH })),
      ...(view?.trim().toLowerCase() === 'today' && (await undatedInToday(env, token.user_id))
        ? { undated: true }
        : {}),
      isNote: (name) => names.has(name.toLowerCase()),
    },
    contextNow(),
  )
  return partial ? { ...answer, partial } : answer
}

/** The space a call names, refused in a sentence where it names none it reaches.
 *  Kept in `seen`, which is what decides whether the answer comes marked. */
async function spaceOf(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<Space> {
  const space = await askedSpace(env, token.user_id, args)
  if (typeof space === 'string') throw new Said(space)
  seen.push(space)
  return space
}

/** The space a write names, refused where the token or the share may not write. */
async function writableSpace(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<Space> {
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

/** The space a task goes to. */
type Writable = Pick<Space, 'id' | 'name' | 'user_id'>

/** A task added to a space the caller may write: to its inbox (`INBOX_PATH`, Orden's
 *  own, which puts no file into the space the reader did not make), or to `note` under
 *  `under`: the connector's `add_task`. Throws the sentence to answer with where it
 *  cannot. */
async function addTaskTo(
  env: Env,
  space: Writable,
  args: Args,
): Promise<{ at: string; space: string; path: string }> {
  // Quick add's grammar over the words, English and German: the account keeps no
  // language, and those are the two its tables have.
  const read = newTask(args, quickWords(['en', 'de'], new Date()))
  const { fields } = read
  const path = await placeNamed(env, space, words(args, 'note') ?? read.note)
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
    )
    return {
      at: `${landed}#${placed.line}:${taskHash(fields.text)}`,
      space: space.name,
      path: landed,
    }
  })
}

async function update(env: Env, token: TokenRow, args: Args, seen: Space[]): Promise<unknown> {
  const space = await writableSpace(env, token, args, seen)
  const anchor = readAt(args.at)
  const path = notePath(anchor.path)
  const done = typeof args.done === 'boolean' ? args.done : undefined
  const change = taskChange(args)
  const today = contextNow().today
  const editing = async () => {
    const held = await readOf(env, space, path)
    if (held === null) throw new Said(`No note at ${path}.`)
    const edited = editedTask(held.words, space.name, path, anchor, change, done, today)
    return { held, edited, said: answerOf(edited) }
  }
  const answerOf = (edited: { at: string; next?: string }) => ({
    at: edited.at,
    ...(edited.next ? { next: edited.next } : {}),
    space: space.name,
  })
  // The task's lines and the note without them.
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
      if (edited.text !== held.words) await written(env, space, path, edited.text, held.note)
      return said
    })
  }

  // Moved: the new note written first, so the task is never in neither.
  const target = typeof moveTo === 'object' ? (moveTo as Args) : { note: moveTo }
  const into =
    typeof target.note === 'string' && target.note.trim()
      ? await placeNamed(env, space, target.note)
      : path
  const under = words(target, 'under')
  const placedIn = await edits(async () => {
    const { held, edited, said } = await editing()
    const { block, source } = taken(edited)
    const there =
      into === path ? { words: source, note: held.note } : await readOf(env, space, into)
    const before = there?.words ?? ''
    const placed = placeIn(before, block.lines, under)
    const landed = await written(
      env,
      space,
      into,
      appliedEdits(before, [placedEdit(placed)]),
      there?.note ?? null,
    )
    return { said, at: `${landed}#${placed.line}:${readAt(edited.at).hash}` }
  })
  if (into === path) return { ...placedIn.said, at: placedIn.at }

  // Read again, and only the task taken out of what it says now: what the other note
  // was given is already written, and must not be given twice. From here a model told
  // only that something failed moves it again, so it is told where the task is.
  const left = await edits(async () => {
    let read
    try {
      read = await editing()
    } catch (error) {
      // Not there as it was: taken out, which is all this was going to do, or edited.
      if (error instanceof AgentError) {
        return `The task is no longer in ${path} as it was. If it was edited there, it is in both: check ${path}.`
      }
      throw error
    }
    await written(env, space, path, taken(read.edited).source, read.held.note)
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
  const { rows, partial } = await rowsOf(env, [space])
  const answer = queryBase(base, words(args, 'view'), rows, contextNow())
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

  const link = base.nib.template
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
  const template = link ? ((await wordsAt(env, space, notePath(link))) ?? '') : ''
  const name = noteName(words(args, 'title') ?? 'Untitled')
  for (let counter = 1; counter < 100; counter++) {
    const file = counter === 1 ? `${name}.md` : `${name} ${counter}.md`
    // A base's filter names the folder, and whoever can write a base can write that.
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
      // A note took the name in between: the next name, and never over it.
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

/** A sentence a task tool answered with rather than a task. */
function refusalOf(error: unknown): string | null {
  return error instanceof Said || error instanceof AgentError ? error.message : null
}

/** Where the words of an answer came from: every space it read or wrote that somebody
 *  else may write in, or null where there is none. Rows, task text, a base's columns
 *  and the paths a write answers with all come out of those notes. */
function sourceOf(seen: readonly Space[]): string | null {
  const sources = [...new Set(seen.map(spaceSource).filter((one) => one !== null))]
  return sources.length ? sources.join(', ') : null
}

/** Runs one of the five, answering JSON, or a sentence where it cannot: inside the
 *  untrusted mark where a space somebody else may write in was read. */
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
