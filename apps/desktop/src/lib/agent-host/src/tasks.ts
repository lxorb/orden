import { shownPath, stemOf } from '@orden/markdown/shown'
import type { Base, Row } from '@orden/bases'
import {
  clockOf,
  editedBase,
  filledTemplate,
  noteName,
  rowPlace,
  rowWords,
  withProperties,
  writeBase,
} from '@orden/bases/agent'
import type { AgentAnswer } from '../../automation/src/api'
import { onDisk as there, folderOf, nameOf } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { writeFile } from '../../file-writes/src/api'
import { DocError } from '../../agent-docs/src/api'
import {
  asked,
  stopWatch,
  type Call,
  done,
  maybe,
  need,
  writerOf,
  Refused,
  judgedForWriting,
  onDisk,
  type Place,
  reachesSpace,
  placeOf,
  sharedSource,
  writableAt,
} from '../../agent-verbs/src/api'
import { inTurn } from '../../agent-docs/src/api'
import { readable, readerBases, readerTodos } from '../../reader-verbs/src/api'
import { at, made, noteOf } from './notes'
import { notes } from './docs'

type Refusing = (error: unknown) => never
async function baseAt(call: Call, name = 'path') {
  const place = placeOf(call)
  return (await readerBases()).baseAt(place, need(call, name))
}
function reachTodos(call: Call): void {
  if (!reachesSpace(call, null))
    throw new Refused('not_granted', 'todos are reached only by agents that reach every space')
}
export async function listTasks(call: Call): Promise<AgentAnswer> {
  const { listTodos } = await readerTodos()
  reachTodos(call)
  return done(listTodos(call.args))
}
export async function addTask(call: Call): Promise<AgentAnswer> {
  const { addTodo, todoTitle } = await readerTodos()
  reachTodos(call)
  const title = todoTitle(call.args)
  const question = await asked(call, null, `Add the todo ${title}`)
  if (question) return question
  return done(await addTodo(call.args, title))
}
export async function updateTask(call: Call): Promise<AgentAnswer> {
  const { todoNamed, updateTodo } = await readerTodos()
  reachTodos(call)
  const was = todoNamed(call.args)
  const question = await asked(call, null, `Change the todo ${was.title}`)
  if (question) return question
  return done(await updateTodo(call.args, was.id))
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
      await notes.writeNote(writerOf(call), at(note), text, read.rev, call.deadline)
      return said
    } catch (error) {
      if (!(error instanceof DocError && error.code === 'rev_changed') || tries > 2) throw error
    }
  }
}
export async function queryBase(call: Call): Promise<AgentAnswer> {
  const place = placeOf(call)
  const { answer, source } = await (await readerBases()).queryBaseAt(place, call.args)
  return done(answer, source)
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
async function templateOf(place: Place, link: string | undefined, rows: readonly Row[]): Promise<string> {
  if (!link) return ''
  const wanted = link.toLowerCase().replace(/\.md$/i, '')
  const found = rows.find(
    (row) =>
      row.kind === 'note' &&
      (row.path.toLowerCase().replace(/\.md$/i, '') === wanted || row.file.basename.toLowerCase() === wanted),
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
  const looksIn = (where.folder ?? folderOf(relative)).trim().replace(/^\/+/, '')
  const folder = looksIn === '' || looksIn === '.' ? '' : judgedForWriting(looksIn)
  const bases = await readerBases()
  const refused: Refusing = bases.refused
  const rows = await bases.rowsStore()
  const template = await templateOf(place, where.template, rows.of(place.space.name))
  const name = judgedForWriting(noteName(maybe(call, 'title') ?? 'Untitled'))
  const path = await freePath(place, folder, name)
  readable(onDisk(place, path), path)
  writableAt(place, onDisk(place, path))
  const question = await asked(call, null, `Make ${shownPath(path)} in ${place.space.name}`)
  if (question) return question
  try {
    const words = rowWords(
      filledTemplate(template, stemOf(nameOf(path)), clockOf(new Date())),
      where.properties,
      properties as Record<string, unknown>,
    )
    return done(await made(place, path, words, null))
  } catch (error) {
    refused(error)
  }
}
export async function editRows(call: Call): Promise<AgentAnswer> {
  const paths = call.args.paths
  const properties = call.args.properties
  if (!Array.isArray(paths) || !paths.length || paths.length > 200 || !paths.every((one) => typeof one === 'string')) {
    throw new Refused('bad_arguments', 'paths is a list of up to 200 note paths')
  }
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Refused('bad_arguments', 'properties is an object of property names and values')
  }
  const refused: Refusing = (await readerBases()).refused
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
function baseEdited(base: Base, ops: unknown, refused: Refusing): Base {
  try {
    return editedBase(base, ops)
  } catch (error) {
    refused(error)
  }
}
export async function editBase(call: Call): Promise<AgentAnswer> {
  const { place, relative, base } = await baseAt(call)
  const refused: Refusing = (await readerBases()).refused
  const path = onDisk(place, relative)
  writableAt(place, path)
  baseEdited(base, call.args.ops, refused)
  const question = await asked(call, null, `Edit ${shownPath(nameOf(relative))} in ${place.space.name}`)
  if (question) return question
  const { written, next } = await inTurn(path, async () => {
    const { text, base: now } = await baseAt(call)
    const next = baseEdited(now, call.args.ops, refused)
    const written = writeBase(next, text)
    if (written !== text) await writeFile(path, written)
    return { written: written !== text, next }
  })
  if (!written) return done({ path: relative, changed: false })
  const { sync } = await import('../../sync-store/src/api')
  sync.nudge()
  return done(
    { path: relative, changed: true, views: next.views.map((view) => view.name) },
    sharedSource(place, relative),
  )
}
