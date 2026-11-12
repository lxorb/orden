import type { Core } from './core'
import type { Doc } from './docs'
import { unixLines } from './kinds'
import { type SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

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
  if (times > 1) return []
  const failed = `${entry.name} not written: ${error instanceof Error ? error.message : String(error)}`
  return [put('log', { at: core.world.now(), space: space.id, pulled: null, pushed: null, failed })]
}

export async function project(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  if (core.pinned.has(entry.id) || space.foreign(entry.id)) return []
  const path = entry.local_path || space.paths().get(entry.id)
  if (!path) return []
  const holder = space.at(path)
  if (holder && holder !== entry) return []

  const text = doc.text()
  const full = core.world.join(space.row.root, path)
  const was = await core.world.disk.read(full)
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
