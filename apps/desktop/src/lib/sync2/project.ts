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
  return [put('written', { id: entry.id, text: unixLines(text) }), put('entries', { ...entry })]
}

/** How many reads in a row a file has to refuse before the reader hears of it: a program
 *  holding it for a moment is no news. */
const READS_TO_TELL = 3

/** Tells the reader, once, that a file's edits here are not reaching the account. */
export function saidUnsynced(core: Core, entry: EntryRow): void {
  if (core.unsyncedTold.has(entry.id)) return
  core.unsyncedTold.add(entry.id)
  core.events.unsynced?.({ id: entry.id, name: entry.name })
}

/** A file that is there refused a read, once more. */
export function readRefused(core: Core, entry: EntryRow): void {
  const times = (core.unreadFor.get(entry.id) ?? 0) + 1
  core.unreadFor.set(entry.id, times)
  if (times >= READS_TO_TELL) saidUnsynced(core, entry)
}

/** A file reads again: a later spell of not reading is news again. */
export function readFine(core: Core, id: string): void {
  core.unreadFor.delete(id)
  core.unsyncedTold.delete(id)
}

/** A file the disk would not take: a name it refuses, a read-only folder, a full disk, a
 *  program holding it. The note stays wanted, in the store as well, so the next pass asks
 *  for it again and writes it then, on the next launch too: with its entry left where it
 *  is, it neither vanishes here nor reads as a delete. The rest of its batch has nothing
 *  to do with it. The reader hears once it has refused a few times, as with a read. */
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
    // Or it will not read: what is there cannot be told from what this note says, and
    // the next pass, which may read it, asks again.
    return notWritten(core, space, entry, doc, new Error('its place on the disk will not read'))
  }
  // A file that is there and will not read, saved as another encoding or grown past what
  // a note holds: what it says cannot be kept as a version, so nothing is written over
  // it. Read again next pass (`readAgain` in ingest.ts), and folded in like any edit.
  if (was === null && entry.local_path && (await core.world.disk.exists(full))) {
    readRefused(core, entry)
    return []
  }
  if (same) {
    const placed = !entry.local_path
    entry.local_path = path
    const digest = await core.world.digest(unixLines(text))
    // A place newly given is news to the store, whatever the words.
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
