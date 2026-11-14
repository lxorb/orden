import { oneEdit } from '@orden/markdown/edits'
import { isTagName } from '@orden/markdown/tags'
import { taskAt } from '@orden/markdown/tasks'
import type { SpaceTag } from '@orden/editor'
import { links } from '../link-index.svelte'
import type { Change } from '../search/apply'
import { lineStarts } from '@orden/scan/search/lines'
import { isMarkdownPath, samePath } from '../space-paths'
import {
  applied,
  appliedToFile,
  changeOf,
  type Edit,
  endingsLike,
  reverse,
} from '../search/replace'
import type { Entry, Space } from '../workspace.svelte'
import type { NoteDoc } from './documents.svelte'
import type { FileAction, FileActions } from './undo.svelte'
import { inFileTurn, keepVersion, readText, writeEdited, writeInTurn } from './in-turn'

export interface HoldsNotes {
  readonly activeSpace: Space | null
  readonly notes: Entry[]
  readonly documents: NoteDoc[]
  readonly undone: FileActions
  tags: SpaceTag[]
  documentAt(path: string): NoteDoc | null
  flush(): void
  loadTree(): Promise<void>
  persist(): unknown
}

export async function loadTags(ws: HoldsNotes): Promise<void> {
  const root = ws.activeSpace?.root
  if (!root) return

  ws.tags = links.spaceTags
  if (!links.scanning) return

  await links.scanned()
  if (samePath(ws.activeSpace.root, root)) ws.tags = links.spaceTags
}

export async function retagNotes(ws: HoldsNotes, from: string, to: string | null): Promise<number> {
  if (to !== null && !isTagName(to)) return 0

  const { tagChanges } = await import('../tag-edits')

  const changes = await tagChanges(
    ws.notes.map((one) => one.path),
    from,
    to,
    (path) => noteText(ws, path),
  )

  const written = await replaceInNotes(ws, changes)
  await loadTags(ws)
  return written
}

export async function noteText(ws: HoldsNotes, path: string): Promise<string | null> {
  ws.flush()

  const open = ws.documentAt(path)
  if (open) return open.text

  return readText(path)
}

export function toggleTaskAt(
  ws: HoldsNotes,
  path: string,
  asked: number,
  hash?: string,
): Promise<boolean> {
  const before = toggling.get(path)
  const running = (before ? waitedFor(before) : Promise.resolve()).then(() =>
    toggled(ws, path, asked, hash),
  )
  const done = () => {
    if (toggling.get(path) === running) toggling.delete(path)
  }
  toggling.set(path, running)
  running.then(done, done)
  return running
}

const toggling = new Map<string, Promise<boolean>>()

const TICK_WAITS = 10_000

function waitedFor(tick: Promise<boolean>): Promise<void> {
  return new Promise((go) => {
    const timer = setTimeout(go, TICK_WAITS)
    const done = () => {
      clearTimeout(timer)
      go()
    }
    tick.then(done, done)
  })
}

async function toggled(
  ws: HoldsNotes,
  path: string,
  asked: number,
  hash?: string,
): Promise<boolean> {
  const before = await noteText(ws, path)
  if (before === null) return false

  const starts = lineStarts(before)
  let line = asked
  if (hash !== undefined) {
    const { taskLine } = await import('../rows/write')
    const found = taskLine(before, { line, hash })
    if (!found) return false
    line = starts.lastIndexOf(found.from)
  }
  const from = starts[line]
  if (from === undefined) return false

  const next = starts[line + 1]
  const task = taskAt(before.slice(from, next === undefined ? before.length : next - 1))
  if (!task) return false

  const { tick, todayOf } = await import('@orden/bases/occurrence')
  const edits = tick(before, line, todayOf())
  if (!edits.length) return false

  return (await replaceInNotes(ws, [changeOf(path, before, edits)])) > 0
}

export async function writeNoteText(
  ws: HoldsNotes,
  path: string,
  before: string,
  after: string,
  keeping: Keeping = {},
): Promise<void> {
  const edit = oneEdit(before, after)
  if (!edit) return

  await replaceInNotes(ws, [changeOf(path, before, [edit])], { ...keeping, anyFile: true })
}

type Undone = Extract<FileAction, { kind: 'replace' }>['notes'][number]

export interface Keeping {
  snapshot?: boolean
  source?: string
  undoable?: boolean
  anyFile?: boolean
  throughLocks?: boolean
}

async function keep(path: string, content: string, keeping: Keeping) {
  if (keeping.snapshot === false) return

  await keepVersion(path, content, keeping.source)
}

export async function replaceInNotes(
  ws: HoldsNotes,
  changes: readonly Change[],
  keeping: Keeping = {},
): Promise<number> {
  const notes =
    keeping.anyFile === true ? changes : changes.filter((one) => isMarkdownPath(one.path))
  if (!notes.length) return 0

  const [{ canWriteAt }, { protection }] = await Promise.all([
    import('../sharing.svelte'),
    import('../protect/protection.svelte'),
  ])
  const writable = notes.filter(
    (change) =>
      canWriteAt(change.path) && (keeping.throughLocks === true || !protection.locked(change.path)),
  )
  if (!writable.length) return 0

  const done: Undone[] = []

  for (const change of writable) {
    const open = ws.documentAt(change.path)
    const wrote = open
      ? await writeOpen(open, change, keeping)
      : await writeClosed(ws, change, keeping)
    if (wrote) done.push(wrote)
  }

  if (done.length && keeping.undoable !== false) ws.undone.record({ kind: 'replace', notes: done })
  await ws.loadTree()
  ws.persist()

  const { sync } = await import('../sync.svelte')
  sync.nudge()
  return done.length
}

async function writeOpen(open: NoteDoc, change: Change, keeping: Keeping): Promise<Undone> {
  open.flush()
  const before = open.text
  const onDisk = open.onDisk
  const took = open.take(change.edits, change.before)
  const after = applied(took.flat, took.edits)

  const written = await writeEdited(open, change.path, took.text, onDisk, () =>
    keep(change.path, before, keeping),
  )
  if (written !== null) links.noteSaved(change.path, written)

  return { path: change.path, content: before, after, edits: reverse(took.flat, took.edits) }
}

async function writeClosed(
  ws: HoldsNotes,
  change: Change,
  keeping: Keeping,
): Promise<Undone | null> {
  const turn = await inFileTurn(change.path, async () => {
    const read = await readText(change.path)
    if (read === null) return null

    const now = endingsLike(read, change.before)
    const foreign = now !== read
    const same = now === change.before
    const edits = same ? change.edits : carriedPast(change.before, now, change.edits)
    if (!edits) return null
    const after = same ? change.after : applied(now, edits)
    const down = foreign ? appliedToFile(read, edits) : after

    await keep(change.path, read, keeping)
    await writeInTurn(change.path, down, false)
    return { read, now, same, edits, after, down }
  })
  if (turn === null) return null
  const { read, now, same, edits, after, down } = turn
  links.noteSaved(change.path, down)

  const late = ws.documentAt(change.path)
  if (late?.live.since(now.replace(/\r\n?/g, '\n'))) catchUp(late, edits, now, after)

  return {
    path: change.path,
    content: read,
    after,
    edits: same ? change.back : reverse(now, edits),
  }
}

function carriedPast(before: string, now: string, edits: readonly Edit[]): Edit[] | null {
  const since = oneEdit(before, now)
  if (!since) return [...edits]

  const grew = since.insert.length - (since.to - since.from)
  const carried: Edit[] = []
  for (const one of edits) {
    if (one.to <= since.from) carried.push(one)
    else if (one.from >= since.to)
      carried.push({ ...one, from: one.from + grew, to: one.to + grew })
    else return null
  }
  return carried
}

function catchUp(note: NoteDoc, edits: readonly Edit[], before: string, written: string) {
  const { text } = note.take(edits, before)
  if (text !== written) note.dirty = true
}
