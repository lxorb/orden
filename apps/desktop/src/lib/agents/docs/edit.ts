import { oneEdit } from '@orden/markdown/edits'
import { applied, changeOf, type Edit } from '../../search/replace'
import type { Keeping } from '../../workspace/note-text'
import { waited, folderOf, movedTo, nameOf, samePath, within } from '../../platform/src/api'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Selected } from './anchors'
import { type Desk, type Located, type NoteAt, openNote, reachable, wordsOf } from './desk'
import { type Planned, plan, readEdits, type Replacement } from './edits'
import { type Agent, showAgent } from './presence'
import { DocError } from './problem'
import { revOf } from './rev'
import { touch, touchedBy, touchedMoved, type Touched } from './touched'
import { Track } from './track'
import { inTurn } from '../turns'

export const TYPING = 2000

export const PATIENCE = 30_000

export interface NoteEdited {
  path: string
  rev: string
  edits: number
  lines: number[]
}

const tracks = new Map<string, Track>()

const kept = new Set<string>()

function keyOf(agent: string, path: string): string {
  return `${agent}\n${path}`
}

function trackOf(agent: Agent, path: string): Track {
  const key = keyOf(agent.id, path)
  const found = tracks.get(key)
  if (found) return found

  const made: Track = new Track(agent.id, (edits) => {
    const now = placed.get(made) ?? path
    touch(now, agent, edits)
    for (const listener of listeners) listener(agent.id, now)
  })
  placed.set(made, path)
  tracks.set(key, made)
  return made
}

const placed = new WeakMap<Track, string>()

type Held = { track: Track; row: Touched | null }[]

const waiting = new Map<string, Held>()

function heldMoved(
  held: Map<string, Held>,
  from: string,
  to: string,
  root: string | undefined,
  join: boolean,
): void {
  for (const [key, one] of [...held]) {
    const [agent, path] = partsOf(key)
    const now = movedTo(path, from, to, root)
    if (now === null || now === path || now === to) continue
    const moved = keyOf(agent, now)
    held.delete(key)
    held.set(moved, join ? [...(held.get(moved) ?? []), ...one] : one)
  }
}

export function tracksMoved(from: string, to: string, root?: string): void {
  heldMoved(aside, from, to, root, true)
  heldMoved(waiting, from, to, root, false)
  for (const [key, track] of [...tracks]) {
    const [agent, path] = partsOf(key)
    const now = movedTo(path, from, to, root)
    if (now === null || now === path) continue

    const moved = keyOf(agent, now)
    tracks.delete(key)
    const there = tracks.get(moved)
    const row = touchedMoved(path, now, agent)
    if (there) {
      const gathered = waiting.get(moved)
      if (gathered) gathered.push({ track: there, row })
      else waiting.set(moved, [{ track: there, row }])
    }
    tracks.set(moved, track)
    placed.set(track, now)
    if (kept.delete(key)) kept.add(moved)

    const back = waiting.get(key)?.pop()
    if (back) {
      tracks.set(key, back.track)
      if (back.row) touch(path, back.row, back.row.edits)
    }
    for (const listener of listeners) listener(agent, now, path)
  }
}

const aside = new Map<string, Held>()

export function tracksRemoved(path: string): void {
  for (const [key, track] of [...tracks]) {
    const [agent, at] = partsOf(key)
    if (within(path, at) === null) continue

    track.setAside()
    tracks.delete(key)
    kept.delete(key)
    const row = touchedBy(at).find((one) => one.id === agent) ?? null
    touch(at, { id: agent, name: row?.name ?? agent }, 0)
    const gathered = aside.get(key)
    if (gathered) gathered.push({ track, row })
    else aside.set(key, [{ track, row }])
    for (const listener of listeners) listener(agent, at)
  }
}

function besideName(at: string, path: string): boolean {
  if (!samePath(folderOf(at), folderOf(path))) return false
  const name = nameOf(at)
  const dot = name.lastIndexOf('.')
  const [stem, end] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  const there = nameOf(path)
  return (
    there.startsWith(`${stem} `) &&
    there.endsWith(end) &&
    /^[1-9]\d*$/.test(there.slice(stem.length + 1, there.length - end.length))
  )
}

export async function tracksCame(
  path: string,
  read: (path: string) => Promise<string | null>,
  putBack = false,
): Promise<void> {
  for (const [key, held] of [...aside]) {
    const [agent, was] = partsOf(key)
    const at = putBack && within(path, was) === null && besideName(was, path) ? path : was
    const now = keyOf(agent, at)
    if (within(path, at) === null || tracks.has(now)) continue

    const words = await read(at)
    if (words === null || tracks.has(now)) continue
    const says = words.replace(/\r\n?/g, '\n')
    const back = [...held].reverse().find((one) => one.track.says === says)
    if (!back) continue

    held.splice(held.indexOf(back), 1)
    if (!held.length) aside.delete(key)
    tracks.set(now, back.track)
    placed.set(back.track, at)
    if (back.row) touch(at, back.row, back.row.edits)
    for (const listener of listeners) listener(agent, at)
  }
}

export function tracksAside(agent: string): [string, Track][] {
  const prefix = keyOf(agent, '')
  return [...aside].flatMap(([key, held]) =>
    key.startsWith(prefix)
      ? held.map(({ track }): [string, Track] => [key.slice(prefix.length), track])
      : [],
  )
}

function partsOf(key: string): [string, string] {
  const split = key.indexOf('\n')
  return [key.slice(0, split), key.slice(split + 1)]
}

const listeners = new Set<Listener>()

type Listener = (agent: string, path: string, was?: string) => void

export function onTracks(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function trackedAgents(): string[] {
  return [...new Set([...tracks.keys()].map((key) => key.slice(0, key.indexOf('\n'))))]
}

export function tracksOf(agent: string): Map<string, Track> {
  const prefix = keyOf(agent, '')
  const found = new Map<string, Track>()
  for (const [key, track] of tracks) {
    if (key.startsWith(prefix)) found.set(key.slice(prefix.length), track)
  }
  return found
}

type Planner = (
  text: string,
  selected: Selected | null,
  open: NoteDoc | null,
  again: boolean,
) => Planned

export async function editNote(
  desk: Desk,
  agent: Agent,
  at: NoteAt,
  edits: unknown,
  ifRev?: string,
): Promise<NoteEdited> {
  const asked = readEdits(edits)
  const note = reachable(desk, at)

  return inTurn(keyOf(agent.id, note.path), () =>
    change(desk, agent, note, ifRev, (text, selected, _open, again) => {
      try {
        return plan(asked, text, selected)
      } catch (error) {
        if (again && error instanceof DocError && error.code !== 'overlapping') {
          throw new DocError(
            'reader_edited_here',
            error.about,
            `the reader edited there: ${error.message}`,
          )
        }
        throw error
      }
    }),
  )
}

export async function writeNote(
  desk: Desk,
  agent: Agent,
  at: NoteAt,
  text: string,
  ifRev?: string,
): Promise<NoteEdited> {
  const note = reachable(desk, at)
  const wanted = text.replace(/\r\n?/g, '\n')
  let first: { text: string; edits: Replacement[] } | null = null

  return inTurn(keyOf(agent.id, note.path), () =>
    change(desk, agent, note, ifRev, (words, _selected, open) => {
      if (first && open) {
        const edits = open.live.carried(first.edits, first.text, true) ?? first.edits
        return { edits, places: [] }
      }

      const edit = oneEdit(words, wanted)
      first = { text: words, edits: edit ? [edit] : [] }
      return { edits: first.edits, places: [] }
    }),
  )
}

async function change(
  desk: Desk,
  agent: Agent,
  note: Located,
  ifRev: string | undefined,
  planner: Planner,
): Promise<NoteEdited> {
  const started = Date.now()
  let again = false

  for (;;) {
    const open = openNote(desk, note)
    if (!open) {
      const done = await changeClosed(desk, agent, note, ifRev, planner)
      if (done) return done
      continue
    }

    const done = changeOpen(desk, agent, note, open, ifRev, planner, again)
    if (done) return done

    if (Date.now() - started > PATIENCE) {
      throw new DocError(
        'reader_typing',
        note.relative,
        'the reader is still writing where the edit goes',
      )
    }
    await quiet(open)
    again = true
  }
}

function quiet(note: NoteDoc): Promise<void> {
  const last = note.live.readerAt ?? 0
  return waited(Math.max(50, TYPING - (Date.now() - last) + 10))
}

function refuseStale(text: string, ifRev: string | undefined, note: Located) {
  if (ifRev === undefined || revOf(text) === ifRev) return
  throw new DocError('rev_changed', note.relative, `${note.relative} has changed since it was read`)
}

function meet(one: { from: number; to: number }, other: { from: number; to: number }): boolean {
  return one.from <= other.to && other.from <= one.to
}

function selectedIn(desk: Desk, open: NoteDoc): Selected | null {
  const view = desk.frontView(open)
  if (!view) return null

  const { from, to } = view.state.selection.main
  return { from, to }
}

function changeOpen(
  desk: Desk,
  agent: Agent,
  note: Located,
  open: NoteDoc,
  ifRev: string | undefined,
  planner: Planner,
  again: boolean,
): NoteEdited | null {
  const text = open.live.text.toString()
  refuseStale(text, ifRev, note)

  const planned = planner(text, selectedIn(desk, open), open, again)
  if (!planned.edits.length) return answer(note, text, planned, null)

  const typed = open.live.touchedWithin(TYPING)
  if (planned.edits.some((edit) => typed.some((one) => meet(one, edit)))) return null

  const track = trackOf(agent, note.path)
  const first = firstEdit(agent, note)
  const changes = track.applyOpen(open, planned.edits, track.nextId(agent.thread))

  if (first && !note.draft) void desk.snapshot(note.path, text, agent.name)

  const last = planned.edits.at(-1)
  if (last) showAgent(open, agent, changes.mapPos(last.to, 1), desk.scheme())

  return answer(note, open.live.text.toString(), planned, changes)
}

async function changeClosed(
  desk: Desk,
  agent: Agent,
  note: Located,
  ifRev: string | undefined,
  planner: Planner,
): Promise<NoteEdited | null> {
  const before = await wordsOf(desk, note)
  if (openNote(desk, note)) return null

  refuseStale(before, ifRev, note)
  const planned = planner(before, null, null, false)
  if (!planned.edits.length) return answer(note, before, planned, null)

  const after = applied(before, planned.edits)
  const track = trackOf(agent, note.path)
  track.catchUp(null, before)
  const id = track.nextId(agent.thread)

  const snapshot = firstEdit(agent, note)
  const wrote = await writeClosed(desk, note, before, planned.edits, {
    snapshot,
    source: agent.name,
  })
  if (!wrote) {
    if (note.pad) return null
    if (snapshot) kept.delete(keyOf(agent.id, note.path))
    await wordsOf(desk, note)
    throw new DocError(
      'rev_changed',
      note.relative,
      `nothing was written to ${note.relative}: it changed as the edit landed, or it cannot be written here`,
    )
  }

  track.recordClosed(before, planned.edits, after, id)
  return answer(note, after, planned, null)
}

async function writeClosed(
  desk: Desk,
  note: Located,
  before: string,
  edits: readonly Edit[],
  keeping?: Keeping,
): Promise<boolean> {
  if (note.pad) return desk.padWrite(before, edits)
  return (await desk.replaceInNotes([changeOf(note.path, before, [...edits])], keeping)) > 0
}

async function wroteBack(
  desk: Desk,
  note: Located,
  words: string,
  back: { edits: readonly Edit[]; refused: () => void },
): Promise<boolean> {
  const wrote = await writeClosed(desk, note, words, back.edits).catch((error: unknown) => {
    back.refused()
    throw error
  })
  if (!wrote) back.refused()
  return wrote
}

function firstEdit(agent: Agent, note: Located): boolean {
  const key = keyOf(agent.id, note.path)
  if (kept.has(key)) return false

  kept.add(key)
  return true
}

function answer(
  note: Located,
  after: string,
  planned: Planned,
  changes: { mapPos(at: number, assoc?: number): number } | null,
): NoteEdited {
  const starts = [0]
  for (let at = after.indexOf('\n'); at !== -1; at = after.indexOf('\n', at + 1))
    starts.push(at + 1)

  const lineOf = (at: number) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((starts[middle] ?? 0) <= at) low = middle
      else high = middle - 1
    }
    return low
  }

  const moved = (at: number) => {
    if (changes) return changes.mapPos(at, 1)
    let shift = 0
    for (const edit of planned.edits) {
      if (edit.from > at) break
      if (edit.to <= at) shift += edit.insert.length - (edit.to - edit.from)
    }
    return at + shift
  }

  return {
    path: note.relative,
    rev: revOf(after),
    edits: planned.edits.length,
    lines: planned.places.map((place) => lineOf(moved(place.from))),
  }
}

export async function undoAgent(desk: Desk, agent: Agent, at: NoteAt): Promise<{ undone: number }> {
  return undoAt(desk, agent, reachable(desk, at))
}

export async function undoAt(desk: Desk, agent: Agent, note: Located): Promise<{ undone: number }> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.steps.size) return { undone: 0 }

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return { undone: track.undoOpen(open) }

    const words = await wordsOf(desk, note)
    const back = track.undoClosed(words)
    if (!back) return { undone: 0 }

    if (!(await wroteBack(desk, note, words, back))) return { undone: 0 }
    return { undone: back.count }
  })
}

export async function undoSomeAt(
  desk: Desk,
  agent: Agent,
  note: Located,
  ids: ReadonlySet<string>,
  token?: string,
): Promise<string[]> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.steps.size) return []

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return track.undoSomeOpen(open, ids, token)

    const words = await wordsOf(desk, note)
    const back = track.undoSomeClosed(words, ids, token)
    if (!back) return []

    if (!(await wroteBack(desk, note, words, back))) return []
    return back.ids
  })
}

export async function putBackAt(
  desk: Desk,
  agent: Agent,
  note: Located,
  token: string,
): Promise<string[]> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.holds(token)) return []

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return track.putBackOpen(open, token)

    const words = await wordsOf(desk, note)
    const back = track.putBackClosed(words, token)
    if (!back) return []

    if (!(await wroteBack(desk, note, words, back))) return []
    return back.ids
  })
}
