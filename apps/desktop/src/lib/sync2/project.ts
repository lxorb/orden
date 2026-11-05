/** A document's words written to its file: the file is the document's projection
 *  (docs/sync-v2.md section 5.1).
 *
 *  Only for a document nothing on screen is holding. A note open in a tab has its words
 *  written by autosave, a pause after they change - whether a keystroke changed them or
 *  another device did - so the engine never writes under a hand that is typing; it hears
 *  that the write happened (`saved`) and records it the same way.
 *
 *  What is recorded is what the next foreign edit is measured against: the words Orden
 *  last wrote (`written`, the ancestor of section 5.5's three-way merge) and their
 *  digest on the entry, which is how a watcher's news is told apart from Orden's own
 *  write. Compared with line endings as the editor holds them, because a file keeps its
 *  own on disk (`as_written` in src-tauri/src/notes.rs). */

import type { Core } from './core'
import type { Doc } from './docs'
import { unixLines } from './kinds'
import { type SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

/** What recording that Orden wrote `text` to an entry's file changes. */
export async function wrote(core: Core, entry: EntryRow, text: string): Promise<Change[]> {
  entry.written_hash = await core.world.digest(unixLines(text))
  core.events.file?.({ id: entry.id, text: unixLines(text) })
  return [put('written', { id: entry.id, text: unixLines(text) }), put('entries', { ...entry })]
}

const READS_TO_TELL = 3

export function saidUnsynced(core: Core, entry: EntryRow): void {
  if (core.unsyncedTold.has(entry.id)) return
  core.unsyncedTold.add(entry.id)
  core.events.unsynced?.({ id: entry.id, name: entry.name })
}

export function readRefused(core: Core, entry: EntryRow): void {
  const times = (core.unreadFor.get(entry.id) ?? 0) + 1
  core.unreadFor.set(entry.id, times)
  if (times >= READS_TO_TELL) saidUnsynced(core, entry)
}

export function readFine(core: Core, id: string): void {
  core.unreadFor.delete(id)
  core.unsyncedTold.delete(id)
}

export function notWritten(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
  error: unknown,
): Change[] {
  core.wanted(space.id).set(entry.id, { docSeq: doc.pulled, epoch: doc.epoch })
  const times = (core.unwrittenFor.get(entry.id) ?? 0) + 1
  core.unwrittenFor.set(entry.id, times)
  if (times >= READS_TO_TELL) saidUnsynced(core, entry)
  const changes = [core.wantChange(space.id)]
  if (times > 1) return changes
  const failed = `${entry.name} not written: ${error instanceof Error ? error.message : String(error)}`
  return [
    ...changes,
    put('log', { at: core.world.now(), space: space.id, pulled: null, pushed: null, failed }),
  ]
}

/** Writes a document's words to its file where nothing on screen holds it, keeping what
 *  the file said before as a version on this device. Answers the changes to record, or
 *  nothing when there is no file to write yet or the file already says it. */
export async function project(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  // Nor over another sync tool's copy, which is that tool's (`foreign` in places.ts).
  if (core.pinned.has(entry.id) || space.foreign(entry.id)) return []
  const path = entry.local_path || space.paths().get(entry.id)
  if (!path) return []
  // Another entry's file is still where this one is going: it moves on first.
  const holder = space.at(path)
  if (holder && holder !== entry) return []

  const text = doc.text()
  const full = core.world.join(space.row.root, path)
  const was = await core.world.disk.read(full)
  // A file nobody here has named yet is in the way: it becomes an entry of its own
  // (ingest), and nothing is written over it. Unless it says these very words: that is
  // this note, written here by a pass that ended before its record was kept.
  const same = was !== null && unixLines(was) === unixLines(text)
  if (!entry.local_path && !same && was !== null) return []
  if (!entry.local_path && !same && (await core.world.disk.exists(full))) {
    return notWritten(core, space, entry, doc, new Error('its place on the disk will not read'))
  }
  if (was === null && entry.local_path && (await core.world.disk.exists(full))) {
    readRefused(core, entry)
    return []
  }
  if (same) {
    const placed = !entry.local_path
    entry.local_path = path
    const digest = await core.world.digest(unixLines(text))
    return entry.written_hash === digest && !placed ? [] : await wrote(core, entry, text)
  }

  try {
    if (was?.trim()) await core.world.disk.keep(full, was)
    await core.world.disk.write(full, text)
  } catch (error) {
    return notWritten(core, space, entry, doc, error)
  }
  if (core.unwrittenFor.delete(entry.id)) readFine(core, entry.id)
  entry.local_path = path
  return await wrote(core, entry, text)
}
