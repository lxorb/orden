import { frontMatterEdit, isPropertyName } from '@orden/markdown/front-matter'
import { taskAt } from '@orden/markdown/tasks'
import { LONGEST_META_VALUE } from '@orden/sync-core'
import { flowItem, scalar } from '@orden/markdown/yaml'
import type { AgentAnswer } from '../automation/caller'
import { OWN_KEYS } from '../own-keys'
import { notePath, joinPath, isRecord } from '../platform/src/api'
import { writeIfAbsent } from '../workspace/write-file'
import { type Tab, workspace } from '../workspace.svelte'
import { isDraft } from '../workspace/drafts'
import { DocError, type NoteRead } from '../agent-docs/src/api'
import { SCRATCHPAD_TAB } from '../agent-docs/src/api'
import { SCRATCHPAD } from '../scratchpad/src/api'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, text, writerOf } from './call'
import { heldIndex, indexOf } from './links'
import { openFile } from './reader-view'
import { Refused } from './problem'
import { createFile, fileKindOf } from './new-files'
import { readable, seen } from './guarded'
import { namedTab, tabsOwnSpace } from './tab-target'
import {
  judged,
  judgedForWriting,
  onDisk,
  type Place,
  placeFor,
  placeOf,
  sharedSource,
  writableAt,
} from './spaces'
import { notes } from './docs'

export function noteOf(
  call: Call,
  writing: boolean,
): { place: Place; relative: string; tab?: string } {
  if (maybe(call, 'tab') === SCRATCHPAD_TAB) {
    namedOnce(call, SCRATCHPAD)
    return {
      place: placeOf(call),
      relative: SCRATCHPAD,
      tab: SCRATCHPAD_TAB,
    }
  }

  if (maybe(call, 'tab') !== null) {
    const named = namedTab(call, ['note'], 'a note')
    namedOnce(call, named.relative)
    if (named.relative !== null) {
      const args = { ...call.args, tab: null, path: named.relative, space: named.place.space.id }
      return noteOf({ ...call, args }, writing)
    }

    const place = placeFor(call, spaceOfTab(named.tab))
    tabsOwnSpace(call, named.tab, place)
    return { place, relative: '', tab: named.tab.id }
  }

  const place = placeOf(call)
  const asked = need(call, 'path')
  const safe = writing ? judgedForWriting(asked) : judged(asked)
  const relative = notePath(safe)
  if (relative === null) throw new Refused('bad_arguments', `${safe} is not a markdown note`)

  readable(onDisk(place, relative), relative)
  if (writing) writableAt(place, onDisk(place, relative))

  return { place, relative }
}

function namedOnce(call: Call, relative: string | null): void {
  const path = maybe(call, 'path')
  if (path === null) return
  if (relative !== null && notePath(judged(path)) === relative) return
  throw new Refused(
    'bad_arguments',
    `path ${path} and tab ${maybe(call, 'tab')} name different notes: pass path for a note by its path, or tab alone for a tab or the scratchpad`,
  )
}

function spaceOfTab(tab: Tab): string {
  const space = isDraft(tab.note) ? workspace.spaceOf(tab.note) : null
  if (space === null) {
    throw new Refused('no_such_tab', `tab ${tab.id} holds a note outside every space`)
  }
  return space
}

export function at({ place, relative, tab }: { place: Place; relative: string; tab?: string }) {
  return { path: relative, space: place.space.id, ...(tab === undefined ? {} : { tab }) }
}

function ifRev(call: Call): string | undefined {
  return maybe(call, 'if_rev') ?? undefined
}

function wordsSent(call: Call): string | null {
  return text(call, 'content') ?? text(call, 'text')
}

export async function readNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, false)
  const { place, relative } = named
  const read: NoteRead = await notes.readNote(at(named), call.args.include)

  if (!place.open && (read.links !== undefined || read.backlinks !== undefined)) {
    const index = await indexOf(place)
    const path = onDisk(place, relative)
    if (read.links !== undefined) read.links = index.outgoing(path)
    if (read.backlinks !== undefined) read.backlinks = index.backlinks(path)
  }
  if (read.backlinks !== undefined) {
    read.backlinks = read.backlinks.filter(
      (one) => !isRecord(one) || typeof one.path !== 'string' || seen(onDisk(place, one.path)),
    )
  }

  return done(read, sharedSource(place, relative))
}

export async function editNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const question = await asked(call, null, `Edit ${relative} in ${place.space.name}`)
  if (question) return question

  return done(await notes.editNote(writerOf(call), at(named), call.args.edits, ifRev(call)))
}

export async function writeNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const words = wordsSent(call)
  if (words === null) throw new Refused('bad_arguments', 'say the content')

  const question = await asked(call, null, `Write ${relative} in ${place.space.name}`)
  if (question) return question

  const written = () => notes.writeNote(writerOf(call), at(named), words, ifRev(call))
  if (named.tab) return done(await written())
  return done(
    await madeOrChanged(place, relative, () => made(place, relative, words, null), written),
  )
}

export async function appendNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const words = wordsSent(call)
  if (words === null) throw new Refused('bad_arguments', 'say the content')

  const question = await asked(call, null, `Add to ${relative} in ${place.space.name}`)
  if (question) return question

  const under = maybe(call, 'under')
  const edit = { at: under === null ? { end: true } : { heading: under }, insert_after: words }
  const added = () => notes.editNote(writerOf(call), at(named), [edit])
  if (named.tab) return done(await added())
  return done(await madeOrChanged(place, relative, () => made(place, relative, words, null), added))
}

function yamlOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(memberOf).join(', ')}]`

  return scalar(typeof value === 'string' ? value : '')
}

function memberOf(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return flowItem(String(value))
}

export async function setProperty(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { relative } = named
  const key = need(call, 'key')
  if (!isPropertyName(key)) throw new Refused('bad_arguments', `${key} is not a key`)
  if (!('value' in call.args)) throw new Refused('bad_arguments', 'say the value, or null')
  const value = yamlOf(call.args.value)

  const question = await asked(call, null, `Set ${key} of ${relative}`)
  if (question) return question

  const own = OWN_KEYS.find((one) => one === key.toLowerCase())
  if (own) {
    const said = call.args.value
    const kept =
      typeof said === 'string' || typeof said === 'number' || typeof said === 'boolean'
        ? String(said) || null
        : null
    if (kept !== null && kept.length > LONGEST_META_VALUE) {
      throw new Refused('bad_arguments', `${key} is too long`)
    }
    const root = named.place.space.root
    workspace.itemMeta.set(joinPath(root, relative), { [own]: kept }, root)
    return done({ path: relative, key: own, value: kept, changed: true })
  }

  for (let tries = 0; ; tries++) {
    const read = await notes.readNote(at(named), ['text'])
    const words = read.text ?? ''
    const edit = frontMatterEdit(words, key, value)
    if (!edit) return done({ path: relative, key, value, changed: false, rev: read.rev })

    const after = words.slice(0, edit.from) + edit.insert + words.slice(edit.to)
    try {
      const wrote = await notes.writeNote(writerOf(call), at(named), after, read.rev)
      return done({ ...wrote, key, value, changed: true })
    } catch (error) {
      if (!(error instanceof DocError && error.code === 'rev_changed') || tries > 2) throw error
    }
  }
}

export async function setTask(call: Call): Promise<AgentAnswer> {
  const note = noteOf(call, true)
  const { relative } = note
  const anchor = call.args.at
  if (typeof anchor !== 'object' || anchor === null || !('task' in anchor)) {
    throw new Refused('bad_arguments', 'at is {task, nth?}')
  }
  const wanted = flag(call, 'done')

  const read = await notes.readNote(at(note), ['text', 'tasks'])
  const named = anchor as { task: unknown; nth?: unknown }
  const row = read.tasks?.find(
    (one) =>
      'task' in one.anchor &&
      one.anchor.task === named.task &&
      (named.nth === undefined || one.anchor.nth === named.nth),
  )
  if (!row) throw new Refused('not_found', `there is no task ${String(named.task)} in ${relative}`)
  if (row.done === wanted) return done({ path: relative, rev: read.rev, changed: false })

  const line = (read.text ?? '').split('\n')[row.line] ?? ''
  const task = taskAt(line)
  if (!task) throw new Refused('not_found', `the task ${String(named.task)} has moved`)

  const question = await asked(call, null, `${wanted ? 'Tick' : 'Clear'} a task in ${relative}`)
  if (question) return question

  const box = task.box + 1
  const ticked = line.slice(0, box) + (wanted ? 'x' : ' ') + line.slice(box + 1)
  const edit = { at: row.anchor, replace: ticked }
  return done(await notes.editNote(writerOf(call), at(note), [edit], read.rev))
}

export async function createNote(call: Call): Promise<AgentAnswer> {
  if (maybe(call, 'tab') !== null)
    throw new Refused('bad_arguments', 'a new note is made at a path')

  const kind = fileKindOf(call)
  if (kind !== 'note') return createFile(call, placeOf(call), kind, made)

  const { place, relative } = noteOf(call, true)
  if ((await workspace.noteText(onDisk(place, relative))) !== null) {
    throw new Refused('exists', `${relative} is already there, and nothing is written over`)
  }

  const question = await asked(call, null, `Make ${relative} in ${place.space.name}`)
  if (question) return question

  const answer = await made(
    place,
    relative,
    wordsSent(call) ?? '',
    flag(call, 'open') ? call : null,
  )
  return done({ ...answer, space: place.space.id })
}

const making = new Map<string, Promise<unknown>>()

export function madeOrChanged<Made, Changed>(
  place: Place,
  relative: string,
  make: () => Promise<Made>,
  change: () => Promise<Changed>,
): Promise<Made | Changed> {
  const path = onDisk(place, relative)
  const turn = (making.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if ((await workspace.noteText(path)) !== null) return change()
      return make().catch(async (error: unknown) => {
        const came = error instanceof Refused && error.code === 'exists'
        if (came && (await workspace.noteText(path)) !== null) return change()
        throw error
      })
    })
  making.set(path, turn)
  void turn
    .catch(() => undefined)
    .finally(() => {
      if (making.get(path) === turn) making.delete(path)
    })
  return turn
}

export async function made(place: Place, relative: string, words: string, open: Call | null) {
  const path = onDisk(place, relative)
  writableAt(place, path)
  if (!(await writeIfAbsent(path, words))) {
    throw new Refused(
      'exists',
      `${relative} is there and would not read, and nothing is written over it`,
    )
  }

  if (place.open) {
    await workspace.loadTree()
    if (open) await openFile(open, path, false)
  } else {
    heldIndex(place)?.noteSaved(path, words)
  }

  const { sync } = await import('../sync.svelte')
  sync.nudge()

  return { path: relative, created: true }
}
