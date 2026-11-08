import { ACCOUNT_INBOX, type Base, type Context, isInboxPath, type Row } from '@orden/bases'
import { readable, seen } from './guarded'
import { meansInbox } from '@orden/bases/inbox'
import {
  AgentError,
  clockOf,
  editedBase,
  editedTask,
  listTasks as listed,
  movedTask,
  newTask,
  quickWords,
  noteName,
  placedEdit,
  placeIn,
  queryBase as queried,
  readAt,
  readBase,
  rowPlace,
  taskBlock,
  taskChange,
  taskIn,
  withProperties,
  writeBase,
} from '@orden/bases/agent'
import { appliedEdits } from '@orden/markdown/edits'
import { taskLine } from '@orden/markdown/task-edits'
import { taskHash } from '@orden/bases'
import { type AgentAnswer, threadSpaceOf } from '../../automation/caller'
import { modes } from '../../modes.svelte'
import { onDisk as there } from '../../on-disk'
import { reachedByOthersIn } from '../../sharing.svelte'
import { folderOf, insideSpace, nameOf, rootedAt } from '../../space-paths'
import { invoke } from '../../tauri'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import { DocError, notes } from '../docs'
import { asked } from './asks'
import { inTurn } from '../turns'
import { nowOf } from '../../views/days'
import { guardedAt } from '../../views/guard'
import { withComment } from '../../views/task-body'
import { type Call, done, flag, maybe, need, writerOf } from './call'
import { at, made, madeOrChanged, noteOf } from './notes'
import { Refused } from './problem'
import {
  judgedForWriting,
  onDisk,
  type Place,
  placeFor,
  placeOf,
  reachable,
  writableAt,
} from './spaces'

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
  const { account } = await import('../../account.svelte')
  return { ...clockOf(new Date()), ...(account.name ? { me: account.name } : {}) }
}

function spacesOf(call: Call): Place[] {
  const named = maybe(call, 'space')
  if (named !== null) return [placeFor(call, named)]
  const open = workspace.activeSpace?.id
  return reachable(call).map((space) => ({ space, open: space.id === open }))
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

export async function listTasks(call: Call): Promise<AgentAnswer> {
  const places = spacesOf(call)
  const rows = await rowsStore()
  const all = places.flatMap((place) =>
    rows.of(place.space.name).filter((row) => seen(onDisk(place, row.path))),
  )
  const view = maybe(call, 'view')
  const base = view && /\.base$/i.test(view) ? await baseToAnswer(call, 'view') : null
  const names = new Set(
    all.filter((row) => row.kind === 'note').map((row) => row.file.basename.toLowerCase()),
  )
  const reached = new Set(places.map((place) => place.space.name))

  try {
    const answer = listed(
      all,
      {
        ...(base ? { base: { base: base.base } } : view ? { view } : {}),
        ...(maybe(call, 'filter') ? { filter: need(call, 'filter') } : {}),
        ...(typeof call.args.limit === 'number' ? { limit: call.args.limit } : {}),
        inboxes: rows.inboxes().filter((one) => reached.has(one.space)),
        undated: modes.undatedInToday,
        isNote: (name) => names.has(name.toLowerCase()),
      },
      await contextOf(),
    )
    return done(answer, sourceOf(places))
  } catch (error) {
    refused(error)
  }
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

function writableNote(call: Call, path: string) {
  return noteOf({ ...call, args: { ...call.args, tab: null, path } }, true)
}

async function inboxPlace(call: Call, place: Place): Promise<Place> {
  if (maybe(call, 'space') !== null || threadSpaceOf(call.caller)) return place
  const { homeRoot } = await import('../../rows/home.svelte')
  const root = homeRoot()
  const home = rootedAt(reachable(call), root)
  return home ? { space: home, open: home.id === workspace.activeSpace?.id } : place
}

export async function addTask(call: Call): Promise<AgentAnswer> {
  const front = placeOf(call)
  const { rows } = await import('../../rows/rows.svelte')
  const { i18n } = await import('../../i18n.svelte')
  const { listNamed, listsIn, makeList } = await import('../../rows/todo-lists')
  const names = listsIn(front.space.root).map((path) => path.replace(/.md$/i, ''))
  const read = (() => {
    try {
      return newTask(call.args, quickWords([i18n.language], new Date(), names))
    } catch (error) {
      refused(error)
    }
  })()
  const { fields } = read
  const named = maybe(call, 'note') ?? read.note ?? null
  const place = named === null ? await inboxPlace(call, front) : front
  const inbox = rows.inboxes().find((one) => one.space === place.space.name)?.path ?? ACCOUNT_INBOX
  const chosen = named === null ? inbox : await namedOrInbox(place, named)
  const path = chosen === inbox || meansInbox(chosen) ? chosen : listNamed(place.space.root, chosen)
  if (path === null)
    refused(new AgentError('bad_arguments', 'note names no to-do list there can be'))
  const note = writableNote({ ...call, args: { ...call.args, space: place.space.id } }, path)
  const under = maybe(call, 'under') ?? read.heading
  const line = taskLine(fields)

  const question = await asked(call, null, `Add a task to ${note.relative}`)
  if (question) return question

  const hash = taskHash(fields.text)
  const placedAt = await madeOrChanged(
    note.place,
    note.relative,
    async () => {
      const placed = placeIn('', [line], under)
      await made(note.place, note.relative, appliedEdits('', [placedEdit(placed)]), null)
      return placed.line
    },
    () =>
      rewritten(call, note, (text) => {
        const placed = placeIn(text, [line], under)
        return { text: appliedEdits(text, [placedEdit(placed)]), said: placed.line }
      }),
  )
  makeList(insideSpace(place.space.root, note.relative))
  return done({ at: `${note.relative}#${placedAt}:${hash}`, space: place.space.name })
}

const ANCHORED = /#\d+:[0-9a-z]+$/

async function listNote(
  call: Call,
  path: string,
  listing: boolean,
): Promise<{ path: string; todo_list: boolean; space: string }> {
  const place = placeOf(call)
  const note = writableNote({ ...call, args: { ...call.args, space: place.space.id } }, path)
  const root = place.space.root
  if (!listing && isInboxPath(note.relative))
    throw new Refused('bad_arguments', `${note.relative} is the inbox, always a to-do list`)
  const full = insideSpace(root, note.relative)
  if ((await workspace.noteText(full)) === null && !(await there(full)))
    throw new Refused('no_such_file', `there is no ${note.relative} in ${place.space.name}`)
  const { makeList, unmakeList } = await import('../../rows/todo-lists')
  if (listing) makeList(full)
  else unmakeList(full)
  return { path: note.relative, todo_list: listing, space: place.space.name }
}

export async function updateTask(call: Call): Promise<AgentAnswer> {
  const listing = typeof call.args.todo_list === 'boolean' ? call.args.todo_list : undefined
  const named = typeof call.args.at === 'string' ? call.args.at.trim() : ''
  if (listing !== undefined && !ANCHORED.test(named)) {
    const question = await asked(call, null, `Change whether ${named} is a to-do list`)
    if (question) return question
    return done(await listNote(call, named, listing))
  }
  const place = placeOf(call)
  const anchor = (() => {
    try {
      return readAt(call.args.at)
    } catch (error) {
      refused(error)
    }
  })()
  const note = writableNote({ ...call, args: { ...call.args, space: place.space.id } }, anchor.path)
  const moveTo = call.args.move_to
  const ticking = 'done' in call.args ? flag(call, 'done') : undefined
  const change = (() => {
    try {
      return taskChange(call.args)
    } catch (error) {
      refused(error)
    }
  })()

  const question = await asked(call, null, `Change a task in ${note.relative}`)
  if (question) return question

  const { today } = clockOf(new Date())
  const comment = typeof call.args.comment === 'string' ? call.args.comment.trim() : ''
  try {
    let said = await rewritten(call, note, (text) => {
      const edited = editedTask(
        text,
        place.space.name,
        note.relative,
        anchor,
        change,
        ticking,
        today,
      )
      const commented = comment
        ? withComment(edited.text, readAt(edited.at), comment, nowOf(new Date()).slice(0, 16))
        : null
      return {
        text: commented ?? edited.text,
        said: { at: edited.at, ...(edited.next ? { next: edited.next } : {}) },
      }
    })
    if (moveTo !== undefined && moveTo !== null) {
      said = { ...said, ...(await moved(call, place, note, readAt(said.at), moveTo)) }
    }
    const listed = listing === undefined ? {} : await listNote(call, anchor.path, listing)
    return done({ ...said, ...listed, space: place.space.name })
  } catch (error) {
    refused(error)
  }
}

async function namedOrInbox(place: Place, named: string): Promise<string> {
  if (!meansInbox(named)) return named
  const { rows } = await import('../../rows/rows.svelte')
  const theirs = rows
    .of(place.space.name)
    .some((row) => row.kind === 'note' && meansInbox(row.path))
  if (theirs) return named
  return rows.inboxes().find((one) => one.space === place.space.name)?.path ?? ACCOUNT_INBOX
}

async function moved(
  call: Call,
  place: Place,
  from: ReturnType<typeof noteOf>,
  anchor: { line: number; hash: string },
  moveTo: unknown,
): Promise<{ at: string }> {
  const target = typeof moveTo === 'string' ? { note: moveTo } : moveTo
  if (typeof target !== 'object' || target === null) {
    throw new Refused('bad_arguments', 'move_to is {note?, under?}')
  }
  const { note: wanted, under } = target as { note?: unknown; under?: unknown }
  const heading = typeof under === 'string' && under.trim() ? under.trim() : undefined
  const into =
    typeof wanted === 'string' && wanted.trim()
      ? writableNote(call, await namedOrInbox(place, wanted.trim()))
      : from

  if (into.relative === from.relative) {
    const line = await rewritten(call, from, (text) => {
      const result = movedTask(
        { text, space: place.space.name, path: from.relative, anchor },
        null,
        heading,
      )
      return { text: result.source, said: result.line }
    })
    return { at: `${from.relative}#${line}:${anchor.hash}` }
  }

  const source = await notes.readNote(at(from), ['text'])
  const words = source.text ?? ''
  const block = taskBlock(
    words,
    taskIn(words, place.space.name, from.relative, anchor).anchor?.line ?? 0,
  )
  const line = await madeOrChanged(
    into.place,
    into.relative,
    async () => {
      const placed = placeIn('', block.lines, heading)
      await made(into.place, into.relative, appliedEdits('', [placedEdit(placed)]), null)
      return placed.line
    },
    () =>
      rewritten(call, into, (text) => {
        const placed = placeIn(text, block.lines, heading)
        return { text: appliedEdits(text, [placedEdit(placed)]), said: placed.line }
      }),
  )
  await notes.writeNote(
    writerOf(call),
    at(from),
    words.slice(0, block.from) + words.slice(block.to),
    source.rev,
  )
  return { at: `${into.relative}#${line}:${anchor.hash}` }
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

  const changed: string[] = []
  for (const note of named) {
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
