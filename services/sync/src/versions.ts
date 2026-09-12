/** What a note said before, on the account.
 *
 *  A device already keeps its own versions, and that is the one a reader reaches
 *  for: it is there instantly, it goes back to before the note was ever synced,
 *  and it costs nobody anything. But it is keyed by the note's path on that
 *  machine, so a rename orphans it, another machine never sees it, and a laptop
 *  that dies takes it with it. This is the other half: keyed by the note's id,
 *  which is the one name for a note that every device agrees on.
 *
 *  What a version is: a body the account was sent. Every push already carries the
 *  whole note, so the versions are the pushes - nothing is computed, diffed or
 *  stored twice. The body goes to R2 under its own hash, so a note that flips
 *  between two states costs two objects however many times it flips, and two
 *  notes that say the same thing cost one; the same arrangement pictures already
 *  use. The row is a moment, a hash, a size and the device that sent it.
 *
 *  What is deliberately not kept:
 *
 *  Every save. At most one version per note per five minutes, which is the same
 *  interval the device's own keeper defaults to. The newest state of a note is
 *  the note, so a version from thirty seconds ago says nothing the file does not.
 *
 *  Forever. A month, thinned after the first day to one an hour - the same two
 *  rules the device's sweep uses, so the two histories read alike. There is no
 *  setting for it: the only thing a longer month would change is the bill for
 *  storage nobody asked to keep, and a reader who does not want their words on
 *  the account has a clearer lever than a slider, which is not to sync. */

import { now } from './crypto'
import type { Env, Note } from './types'

/** How long the account keeps a version. */
export const KEEP_FOR = 30 * 24 * 60 * 60 * 1000

/** The closest two versions of one note are allowed to be. */
const VERSION_EVERY = 5 * 60 * 1000

/** Everything from the last day is kept as it happened; older than that, one per
 *  hour survives. */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** How much one sweep does. Counted in writes rather than rows, because a Worker
 *  invocation has a ceiling on those and a busy month has plenty of both. */
const AT_ONCE = 400

/** How many rows the thinning pass looks at in one run. */
const READ_AT_ONCE = 4000

/** The most versions a route hands back at once. A month of one an hour is 720,
 *  and a list nobody scrolls is a list nobody reads. */
const MOST_SHOWN = 300

/** How long a device's name may be. */
const DEVICE_LIMIT = 40

export interface Version {
  note_id: string
  at: number
  hash: string
  size: number
  by: string
}

/** Where a version's bytes live. Its hash, so the same words are stored once. */
export function versionKey(hash: string): string {
  return `versions/${hash}`
}

export function presentVersion(version: Version) {
  return { at: version.at, size: version.size, by: version.by }
}

/** The name a device sent for itself, as far as it is worth keeping. */
export function deviceIn(header: string | undefined): string {
  return (header ?? '')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, DEVICE_LIMIT)
}

/** Keeps what the account was just sent, unless it says nothing new.
 *
 *  Called from the one place every note body arrives through, so a note that a
 *  room settled between four devices is kept the same way a note one device
 *  pushed is. Best effort by design: a version that could not be written is not a
 *  reason to fail the save that carried it, and the note itself is already
 *  safely stored by the time this runs. */
export async function keepVersion(
  env: Env,
  note: Pick<Note, 'id' | 'hash' | 'size'>,
  content: string,
  by = '',
): Promise<void> {
  const newest = await env.DB.prepare(
    'select at, hash from note_versions where note_id = ? order by at desc limit 1',
  )
    .bind(note.id)
    .first<{ at: number; hash: string }>()

  // Nothing new to say, or too soon to say it again.
  if (newest?.hash === note.hash) return
  if (newest && now() - newest.at < VERSION_EVERY) return

  // The bytes before the row, so a row never names a body that is not there. A
  // hash another note already keeps needs neither.
  const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
    .bind(note.hash)
    .first<{ one: number }>()

  if (!held) await env.NOTES.put(versionKey(note.hash), content)

  await env.DB.prepare(
    'insert or ignore into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
  )
    .bind(note.id, now(), note.hash, note.size, by)
    .run()
}

/** Every version of one note, newest first. */
export async function versionsOf(env: Env, noteId: string): Promise<Version[]> {
  const { results } = await env.DB.prepare(
    'select * from note_versions where note_id = ? order by at desc limit ?',
  )
    .bind(noteId, MOST_SHOWN)
    .all<Version>()

  return results
}

/** What one version said, or null for a moment this note has no version at. */
export async function versionAt(env: Env, noteId: string, at: number): Promise<string | null> {
  const version = await env.DB.prepare(
    'select hash from note_versions where note_id = ? and at = ?',
  )
    .bind(noteId, at)
    .first<{ hash: string }>()

  if (!version) return null

  const object = await env.NOTES.get(versionKey(version.hash))
  return object ? await object.text() : ''
}

/** What every note under a path said at a moment: the newest version at or
 *  before it, for the notes that have one.
 *
 *  Deleted notes are in, because a note that was deleted after that moment is
 *  one of the things a rollback is for. */
export async function versionsAt(
  env: Env,
  spaceId: string,
  under: string,
  at: number,
): Promise<{ note_id: string; path: string; hash: string; live: string }[]> {
  const prefix = under ? `${under.replace(/\/+$/, '')}/%` : '%'

  const { results } = await env.DB.prepare(
    `select v.note_id as note_id, n.path as path, v.hash as hash, n.hash as live
       from note_versions v
       join notes n on n.id = v.note_id
      where n.space_id = ?1 and n.path like ?2 and v.at <= ?3
        and v.at = (select max(at) from note_versions where note_id = v.note_id and at <= ?3)
      order by n.path
      limit ?4`,
  )
    .bind(spaceId, prefix, at, AT_ONCE)
    .all<{ note_id: string; path: string; hash: string; live: string }>()

  return results
}

/** The sweep: a month, thinned to one an hour after the first day.
 *
 *  Bodies go only when the last row naming one has gone, and the whole run is
 *  bounded: a sweep that tried to catch up on a year in one invocation would be
 *  stopped in the middle by the platform rather than by us, and the next night
 *  would start again from the same place. */
export async function sweepVersions(env: Env, at: number): Promise<number> {
  const freed = new Set<string>()

  // Older than the month.
  const old = await env.DB.prepare(
    `delete from note_versions
      where rowid in (select rowid from note_versions where at < ? limit ?)
      returning hash`,
  )
    .bind(at - KEEP_FOR, AT_ONCE)
    .all<{ hash: string }>()

  for (const row of old.results) freed.add(row.hash)

  // And the thinning, for what is left beyond the first day.
  const { results } = await env.DB.prepare(
    'select note_id, at, hash from note_versions where at < ? order by note_id, at desc limit ?',
  )
    .bind(at - DAY, READ_AT_ONCE)
    .all<{ note_id: string; at: number; hash: string }>()

  const crowded = tooClose(results)
  for (const row of crowded.slice(0, AT_ONCE)) {
    await env.DB.prepare('delete from note_versions where note_id = ? and at = ?')
      .bind(row.note_id, row.at)
      .run()
    freed.add(row.hash)
  }

  let gone = 0
  for (const hash of freed) {
    const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
      .bind(hash)
      .first<{ one: number }>()

    if (held) continue
    await env.NOTES.delete(versionKey(hash))
    gone += 1
  }

  return gone
}

/** Which of these rows an hour already has a newer version in. Given newest
 *  first per note, so the first row in each bucket is the one that stays. */
export function tooClose(
  rows: readonly { note_id: string; at: number; hash: string }[],
): { note_id: string; at: number; hash: string }[] {
  const kept = new Set<string>()
  const crowded: { note_id: string; at: number; hash: string }[] = []

  for (const row of rows) {
    const bucket = `${row.note_id}:${Math.floor(row.at / HOUR)}`
    if (kept.has(bucket)) crowded.push(row)
    else kept.add(bucket)
  }

  return crowded
}

/** Everything the account remembered one note saying, gone for good.
 *
 *  Called when a note's words are purged rather than when it is deleted: a note
 *  in Recently deleted is one somebody may still want back, and its history is
 *  part of what coming back means. Each body goes only once the last row naming
 *  it has, which is what keeps a version another note shares. */
export async function forgetVersions(env: Env, noteId: string): Promise<number> {
  const { results } = await env.DB.prepare(
    'delete from note_versions where note_id = ? returning hash',
  )
    .bind(noteId)
    .all<{ hash: string }>()

  let gone = 0
  for (const hash of new Set(results.map((one) => one.hash))) {
    const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
      .bind(hash)
      .first<{ one: number }>()

    if (held) continue
    await env.NOTES.delete(versionKey(hash))
    gone += 1
  }

  return gone
}
