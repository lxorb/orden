import type { Base, Context, Row } from '@orden/bases'
import { readable, seen } from './guarded'
import {
  AgentError,
  clockOf,
  editedBase,
  noteName,
  queryBase as queried,
  readBase,
  rowPlace,
  withProperties,
  writeBase,
} from '@orden/bases/agent'
import type { AgentAnswer } from '../../automation/caller'
import { onDisk as there } from '../../on-disk'
import { reachedByOthersIn } from '../../sharing.svelte'
import { folderOf, nameOf } from '../../space-paths'
import { invoke } from '../../tauri'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import { DocError, notes } from '../docs'
import { asked } from './asks'
import { inTurn } from '../turns'
import { stopWatch } from './stopping'
import { guardedAt } from './guard'
import { isPriority, type Priority, type Todo, type TodoPatch } from '../../tasks-model/src/api'
import { type Call, done, flag, maybe, need, writerOf } from './call'
import { at, made, noteOf } from './notes'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place, placeFor, placeOf, writableAt } from './spaces'

async function rowsStore() {
  const { rows } = await import('../../rows/rows.svelte')
  for (let waited = 0; !rows.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rows
}

function refused(error: unknown): never {
  if (error instanceof AgentError) throw new Refused(error.code, error.message)
  throw error
}

async function contextOf(): Promise<Context> {
  const { account } = await import('../../accounts/src/api')
  return { ...clockOf(new Date()), ...(account.name ? { me: account.name } : {}) }
}

function sourceOf(places: readonly Place[]): string | null {
  const shared = places.filter((place) => reachedByOthersIn(place.space.root))
  return shared.length ? `shared space ${shared.map((one) => one.space.name).join(', ')}` : null
}

async function baseAt(
  call: Call,
  name = 'path',
): Promise<{ place: Place; relative: string; text: string; base: Base }> {
  const place = placeOf(call)
  const relative = judgedForWriting(need(call, name))
  if (!/\.base$/i.test(relative))
    throw new Refused('bad_arguments', `${relative} is not a .base file`)
  readable(onDisk(place, relative), relative)
  const text = await invoke<string>('read_note', { path: onDisk(place, relative) }).catch(
    () => null,
  )
  if (text === null)
    throw new Refused('no_such_file', `there is no ${relative} in ${place.space.name}`)
  try {
    return { place, relative, text, base: readBase(text) }
  } catch (error) {
    throw new Refused('bad_arguments', `${relative} does not read: ${String(error)}`)
  }
}

async function baseToAnswer(call: Call, name = 'path') {
  const found = await baseAt(call, name)
  const base = guardedAt(found.base, onDisk(found.place, found.relative))
  if (!base) throw new Refused('bad_arguments', `${found.relative} could take too long to answer`)
  return { ...found, base }
}

async function model() {
  return import('../../tasks-model/src/api')
}

function todoOut(todo: Todo) {
  return {
    id: todo.id,
    title: todo.title,
    done: todo.done,
    labels: todo.labels,
    space: todo.space,
    start: todo.start,
    deadline: todo.deadline,
    priority: todo.priority,
    ...(todo.description ? { description: todo.description } : {}),
    ...(todo.subtasks.length ? { subtasks: todo.subtasks } : {}),
  }
}

function spaceIdOf(call: Call): string | null {
  const named = maybe(call, 'space')
  if (named !== null) return placeFor(call, named).space.id
  return workspace.activeSpace?.id ?? null
}

function textsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((one): one is string => typeof one === 'string')
}

function dayArg(call: Call, name: string): string | null | undefined {
  const value = call.args[name]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string')
    throw new Refused('bad_arguments', `${name} is a day as YYYY-MM-DD`)
  return value
}

function priorityArg(call: Call): Priority | undefined {
  const value = call.args.priority
  if (value === undefined) return undefined
  if (!isPriority(value)) throw new Refused('bad_arguments', 'priority is 0, 1, 2 or 3')
  return value
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function patchOf(call: Call): TodoPatch {
  const patch: Mutable<TodoPatch> = {}
  const title = maybe(call, 'title') ?? maybe(call, 'text')
  if (title !== null) patch.title = title
  const description = maybe(call, 'description')
  if (description !== null) patch.description = description
  const labels = textsOf(call.args.labels) ?? textsOf(call.args.tags)
  if (labels !== undefined) patch.labels = labels
  if ('space' in call.args) patch.space = spaceIdOf(call)
  const start = dayArg(call, 'start')
  if (start !== undefined) patch.start = start
  const deadline = dayArg(call, 'deadline') ?? dayArg(call, 'due')
  if (deadline !== undefined) patch.deadline = deadline
  const priority = priorityArg(call)
  if (priority !== undefined) patch.priority = priority
  if ('done' in call.args) patch.done = flag(call, 'done')
  return patch
}

export async function listTasks(call: Call): Promise<AgentAnswer> {
  const { todos, shownTodos, sortedTodos, dayOf } = await model()
  const only = maybe(call, 'space') !== null
  const label = maybe(call, 'label')
  const limit = typeof call.args.limit === 'number' ? Math.max(1, call.args.limit) : 50
  const shown = sortedTodos(
    shownTodos(todos.todos, { onlySpace: only, space: spaceIdOf(call), label, today: dayOf() }),
    'deadline',
  ).filter((one) => flag(call, 'done') || !one.done)
  return done({ total: shown.length, todos: shown.slice(0, limit).map(todoOut) })
}

export async function addTask(call: Call): Promise<AgentAnswer> {
  const { todos } = await model()
  const title = maybe(call, 'title') ?? need(call, 'text')
  const question = await asked(call, null, `Add the todo ${title}`)
  if (question) return question
  const patch = patchOf(call)
  const made = await todos.add({
    ...patch,
    title,
    space: 'space' in call.args ? (patch.space ?? null) : (workspace.activeSpace?.id ?? null),
  })
  if (!made.ok) throw new Refused('bad_arguments', made.error.message)
  return done(todoOut(made.value))
}

export async function updateTask(call: Call): Promise<AgentAnswer> {
  const { todos } = await model()
  const id = maybe(call, 'id') ?? need(call, 'at')
  const was = todos.todo(id)
  if (!was) throw new Refused('no_such_file', `there is no todo ${id}`)
  const question = await asked(call, null, `Change the todo ${was.title}`)
  if (question) return question
  const kept = await todos.update(id, patchOf(call))
  if (!kept.ok) throw new Refused('bad_arguments', kept.error.message)
  return done(todoOut(kept.value))
}

function writableNote(call: Call, path: string) {
  return noteOf({ ...call, args: { ...call.args, tab: null, path } }, true)
}

async function rewritten<T>(
  call: Call,
  note: ReturnType<typeof noteOf>,
  work: (text: string) => { text: string; said: T },
): Promise<T> {
  for (let tries = 0; ; tries++) {
    const read = await notes.readNote(at(note), ['text'])
    const { text, said } = work(read.text ?? '')
    if (text === read.text) return said
    try {
      await notes.writeNote(writerOf(call), at(note), text, read.rev)
      return said
    } catch (error) {
      if (!(error instanceof DocError && error.code === 'rev_changed') || tries > 2) throw error
    }
  }
}

export async function queryBase(call: Call): Promise<AgentAnswer> {
  const yaml = maybe(call, 'yaml')
  const { place, base } =
    yaml === null
      ? await baseToAnswer(call)
      : (() => {
          try {
            return { place: placeOf(call), base: readBase(yaml) }
          } catch (error) {
            throw new Refused('bad_arguments', `the yaml does not read: ${String(error)}`)
          }
        })()
  const rows = await rowsStore()
  try {
    const answer = queried(
      base,
      maybe(call, 'view') ?? undefined,
      rows.of(place.space.name).filter((row) => seen(onDisk(place, row.path))),
      await contextOf(),
    )
    return done(answer, sourceOf([place]))
  } catch (error) {
    refused(error)
  }
}

async function freePath(place: Place, folder: string, name: string): Promise<string> {
  for (let counter = 1; counter < 100; counter++) {
    const file = counter === 1 ? `${name}.md` : `${name} ${counter}.md`
    const relative = folder ? `${folder}/${file}` : file
    const path = onDisk(place, relative)
    if ((await workspace.noteText(path)) === null && !(await there(path))) return relative
  }
  throw new Refused('exists', `${name} is taken a hundred times over in ${folder || 'the space'}`)
}

async function templateOf(place: Place, base: Base, rows: readonly Row[]): Promise<string> {
  const link = base.orden.template
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
  if (!link) return ''
  const wanted = link.toLowerCase().replace(/\.md$/i, '')
  const found = rows.find(
    (row) =>
      row.kind === 'note' &&
      (row.path.toLowerCase().replace(/\.md$/i, '') === wanted ||
        row.file.basename.toLowerCase() === wanted),
  )
  if (!found) return ''
  readable(onDisk(place, found.path), found.path)
  return (await workspace.noteText(onDisk(place, found.path))) ?? ''
}

export async function addRow(call: Call): Promise<AgentAnswer> {
  const { place, relative, base } = await baseAt(call, 'base')
  const properties = call.args.properties ?? {}
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Refused('bad_arguments', 'properties is an object of property names and values')
  }
  const where = rowPlace(base, maybe(call, 'view') ?? undefined)
  const folder = judgedForWriting(where.folder ?? folderOf(relative)).replace(/^\.$/, '')
  const rows = await rowsStore()
  const template = await templateOf(place, base, rows.of(place.space.name))
  const name = noteName(maybe(call, 'title') ?? 'Untitled')
  const path = await freePath(place, folder === '.' ? '' : folder, name)
  readable(onDisk(place, path), path)
  writableAt(place, onDisk(place, path))

  const question = await asked(call, null, `Make ${path} in ${place.space.name}`)
  if (question) return question

  try {
    const words = withProperties(template, {
      ...where.properties,
      ...(properties as Record<string, unknown>),
    })
    return done(await made(place, path, words, null))
  } catch (error) {
    refused(error)
  }
}

export async function editRows(call: Call): Promise<AgentAnswer> {
  const paths = call.args.paths
  const properties = call.args.properties
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 200 ||
    !paths.every((one) => typeof one === 'string')
  ) {
    throw new Refused('bad_arguments', 'paths is a list of up to 200 note paths')
  }
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Refused('bad_arguments', 'properties is an object of property names and values')
  }
  const named = paths.map((path) => writableNote(call, path))

  const question = await asked(call, null, `Set properties on ${named.length} notes`)
  if (question) return question

  const going = await stopWatch(call)
  const changed: string[] = []
  for (const note of named) {
    going(`changed ${changed.length ? changed.join(', ') : 'none'}`)
    try {
      const wrote = await rewritten(call, note, (text) => {
        const after = withProperties(text, properties as Record<string, unknown>)
        return { text: after, said: after !== text }
      })
      if (wrote) changed.push(note.relative)
    } catch (error) {
      refused(error)
    }
  }
  return done({ changed })
}

function baseEdited(base: Base, ops: unknown): Base {
  try {
    return editedBase(base, ops)
  } catch (error) {
    refused(error)
  }
}

export async function editBase(call: Call): Promise<AgentAnswer> {
  const { place, relative, base } = await baseAt(call)
  const path = onDisk(place, relative)
  writableAt(place, path)
  baseEdited(base, call.args.ops)

  const question = await asked(call, null, `Edit ${nameOf(relative)} in ${place.space.name}`)
  if (question) return question

  const { written, next } = await inTurn(path, async () => {
    const { text, base: now } = await baseAt(call)
    const next = baseEdited(now, call.args.ops)
    const written = writeBase(next, text)
    if (written !== text) await writeFile(path, written)
    return { written: written !== text, next }
  })
  if (!written) return done({ path: relative, changed: false })
  const { sync } = await import('../../sync.svelte')
  sync.nudge()
  return done({ path: relative, changed: true, views: next.views.map((view) => view.name) })
}
