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

import { cleanName, now } from './crypto'
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

/** The most versions a route hands back at once. A month of one an hour is 720,
 *  and a list nobody scrolls is a list nobody reads. */
const MOST_SHOWN = 300

/** The most versions the account keeps of any one note.
 *
 *  A month under the two rules above is the first day at one every five minutes
 *  and twenty-nine days at one an hour, which is 984 - so a note somebody writes
 *  in every day of a month lands just under this and nothing anybody does reaches
 *  it by accident.
 *
 *  It is here rather than left to the sweep because the sweep runs nightly with a
 *  write budget, and a note written in all day makes 288 versions between two
 *  runs of it. A ceiling that holds where the version is written is one the
 *  bucket can be sized against; one that waits for a sweep is a hope. */
export const MOST_KEPT = 1024

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

/** The name a device sent for itself, as far as it is worth keeping.
 *
 *  Empty is a real answer and means no one device wrote those words: a note a
 *  room settled between however many were in it, the note a new space arrives
 *  with, or a connected app writing through the connector. The history sheet
 *  shows the moment with no name beside it, which is what the device's own
 *  snapshots look like. See docs/sync.md. */
export function deviceIn(header: string | undefined): string {
  // Cleaned the way a person's name is, because that is what it is: a word
  // somebody's client chose, shown in the history sheet and beside a session in
  // the Account pane. A newline was already taken out; the rest of the control
  // characters were not, and a name is words and not layout either way.
  //
  // Cut by code point rather than by unit, so a bound of forty never lands in
  // the middle of an emoji and leaves half a character in the column.
  return [...cleanName(header ?? '')].slice(0, DEVICE_LIMIT).join('')
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

  await keepAtMost(env, note.id)
}

/** The ceiling on one note's history, held where the version is written.
 *
 *  Counted rather than read, because almost every save is nowhere near the
 *  ceiling and a count on the note's own index is one seek. Over it, the oldest
 *  go - which is the same answer the month gives, arrived at sooner. */
async function keepAtMost(env: Env, noteId: string): Promise<void> {
  const held = await env.DB.prepare(
    'select count(*) as many from note_versions where note_id = ?',
  )
    .bind(noteId)
    .first<{ many: number }>()

  const over = (held?.many ?? 0) - MOST_KEPT
  if (over <= 0) return

  const { results } = await env.DB.prepare(
    `delete from note_versions
      where note_id = ?1
        and at in (select at from note_versions where note_id = ?1 order by at limit ?2)
      returning hash`,
  )
    .bind(noteId, over)
    .all<{ hash: string }>()

  await forgetBodies(env, results.map((one) => one.hash))
}

/** The bodies of versions that have gone, for the hashes no row names any more.
 *
 *  The one place a version's bytes are taken away, because the rule is one rule:
 *  a body goes when the last row naming it has, so a version two notes share
 *  outlives either of them losing it. Answers how many went. */
async function forgetBodies(env: Env, hashes: Iterable<string>): Promise<number> {
  let gone = 0

  for (const hash of new Set(hashes)) {
    const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
      .bind(hash)
      .first<{ one: number }>()

    if (held) continue
    await env.NOTES.delete(versionKey(hash))
    gone += 1
  }

  return gone
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

/** What one version said, or null for a moment this note has no version at.
 *
 *  Null as well for a row whose body has gone, which is the same answer for the
 *  same reason: there is nothing to show. Answering that with no words at all is
 *  worse than answering nothing - the history sheet would draw an empty note, and
 *  restoring it would write that emptiness over the words somebody still has. */
export async function versionAt(env: Env, noteId: string, at: number): Promise<string | null> {
  const version = await env.DB.prepare(
    'select hash from note_versions where note_id = ? and at = ?',
  )
    .bind(noteId, at)
    .first<{ hash: string }>()

  if (!version) return null

  const object = await env.NOTES.get(versionKey(version.hash))
  return object ? await object.text() : null
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

  // And the thinning, for what is left beyond the first day: one statement per
  // note rather than one per row.
  //
  // Which is the difference between a promise the sweep keeps and one it does
  // not. A note written in all day is 288 rows, of which 264 are crowded, and a
  // budget counted in rows spent the whole night's on a single note - so with two
  // busy notes the month thinned to one an hour was simply not what the account
  // held, and every night began the same distance behind. A statement a note is
  // 400 notes a night instead, and a note is only ever behind by one run.
  const { results: busy } = await env.DB.prepare(
    'select distinct note_id from note_versions where at < ? limit ?',
  )
    .bind(at - DAY, AT_ONCE)
    .all<{ note_id: string }>()

  for (const one of busy) {
    const thinned = await env.DB.prepare(
      `delete from note_versions
        where note_id = ?1 and at < ?2
          and at not in (select max(at) from note_versions
                          where note_id = ?1 and at < ?2
                          group by cast(at / ?3 as integer))
        returning hash`,
    )
      .bind(one.note_id, at - DAY, HOUR)
      .all<{ hash: string }>()

    for (const row of thinned.results) freed.add(row.hash)
  }

  return await forgetBodies(env, freed)
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

  return await forgetBodies(
    env,
    results.map((one) => one.hash),
  )
}
