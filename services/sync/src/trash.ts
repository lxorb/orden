import { freePath } from '@nib/markdown/paths'
import { Hono } from 'hono'
import { chunks, places } from './bound'
import { now } from './crypto'
import { atNextSeq, noteKey, presentNote, TAKEN_SEQ } from './notes'
import { snapshotKey } from './rooms/epoch'
import { deviceOf } from './sync2/device'
import { deleteById } from './sync2/ops'
import { presentSpace } from './spaces/space'
import type { Env, Note, Space, Variables } from './types'
import { forgetWords } from './blog/words'
import { forgetPictures, picturesOf } from './pictures'
import { forgetVersions } from './versions'
import { noteUnused, RIGHT_AFTER, NIGHTLY, sweepUnused } from './unused'
import { readSpaceFiles } from './spaces/files'
import { readSite } from './blog/site'
import { FRONT_REV } from './blog/front'
import { forgetEmptyGuest } from './guests'

/** How long Recently deleted holds on to something. */
const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

/** How much of it is handled in one go.
 *
 *  Emptying something takes one write to R2 apiece, and a Worker has only so
 *  many of those in a single request; the daily job is under the same ceiling.
 *  So both work through a batch at a time. Purging is idempotent, so what is
 *  left over goes on the next tap of the button or the next night's run - the
 *  listing says `more` when there is any. */
export const AT_ONCE = 500

/** `wanted` if nobody has it, else the first free `wanted 2`, `wanted 3`... -
 *  the numbering the app gives a new space whose name is taken. */
export function freeName(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted
  for (let counter = 2; ; counter++) {
    const candidate = `${wanted} ${counter}`
    if (!taken.has(candidate)) return candidate
  }
}

type DeletedNote = Note & { space_name: string }

async function deletedSpaces(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    `select * from spaces
      where user_id = ? and deleted = 1 and deleted_at is not null
      order by deleted_at desc limit ?`,
  )
    .bind(userId, AT_ONCE)
    .all<Space>()
  return results
}

/** Deleted notes of live spaces. A deleted space keeps its notes to itself:
 *  they come back with it, not one by one.
 *
 *  The account's own spaces and no others. Recently deleted gives back storage,
 *  and the storage a shared space uses is its owner's; a writer emptying their
 *  own would otherwise reach into somebody else's account and take away notes
 *  for good. What a writer deleted is still in their own machine's trash, and
 *  the owner still sees it here. */
async function deletedNotes(env: Env, userId: string): Promise<DeletedNote[]> {
  const { results } = await env.DB.prepare(
    `select n.*, s.name as space_name from notes n
       join spaces s on s.id = n.space_id
      where s.user_id = ? and s.deleted = 0 and n.deleted = 1 and n.deleted_at is not null
        and n.kind != 'file'
      order by n.deleted_at desc limit ?`,
  )
    .bind(userId, AT_ONCE)
    .all<DeletedNote>()
  return results
}

async function deletedSpace(env: Env, userId: string, id: string): Promise<Space | null> {
  return (
    (await env.DB.prepare(
      'select * from spaces where id = ? and user_id = ? and deleted = 1 and deleted_at is not null',
    )
      .bind(id, userId)
      .first<Space>()) ?? null
  )
}

async function deletedNote(
  env: Env,
  userId: string,
  id: string,
): Promise<(Note & { space_deleted: number }) | null> {
  return (
    (await env.DB.prepare(
      `select n.*, s.deleted as space_deleted from notes n
         join spaces s on s.id = n.space_id
        where n.id = ? and s.user_id = ? and n.deleted = 1 and n.deleted_at is not null`,
    )
      .bind(id, userId)
      .first<Note & { space_deleted: number }>()) ?? null
  )
}

/** The hashes of the blobs a note uses: its file's bytes, its paper and the pictures
 *  written down for its body - or read out of the body, for a note written before
 *  they were (blog/fill.ts). */
async function usedBy(env: Env, note: Pick<Note, 'id' | 'space_id'>): Promise<Set<string>> {
  const row = await env.DB.prepare(
    'select kind, hash, paper, front_rev, size from notes where id = ?',
  )
    .bind(note.id)
    .first<{ kind: string; hash: string; paper: string | null; front_rev: number; size: number }>()
  const used = new Set<string>()
  if (!row) return used
  if (row.kind === 'file' && row.hash) used.add(row.hash)
  if (row.paper) used.add(row.paper)

  const { results } = await env.DB.prepare('select hash from note_pictures where note_id = ?')
    .bind(note.id)
    .all<{ hash: string }>()
  for (const one of results) used.add(one.hash)

  if (row.kind !== 'file' && row.size > 0 && row.front_rev < FRONT_REV) {
    const object = await env.NOTES.get(noteKey(note.space_id, note.id))
    for (const hash of picturesOf(object ? await object.text() : '')) used.add(hash)
  }
  return used
}

/** Takes a note's content away for good. The row stays as the tombstone the
 *  change feed relies on, and stops being listed. */
async function purgeNote(env: Env, note: Pick<Note, 'id' | 'space_id'>) {
  // What the note used of the owner's blobs, read before the purge takes it away; see
  // unused.ts. A note written before its pictures were has its body read for them.
  const used = await usedBy(env, note)

  await env.NOTES.delete([noteKey(note.space_id, note.id), snapshotKey(note.id)])
  // And what the account remembered it saying before. A version of a note whose
  // words have gone for good is a version of nothing; the bodies go with the
  // rows, each only once the last row naming it has gone. See versions.ts.
  await forgetVersions(env, note.id)
  await forgetWords(env, note.id).catch(() => undefined)
  await forgetPictures(env, note.id).catch(() => undefined)
  // And its paper, which the tombstone would otherwise still serve to whoever reaches
  // the note, and which the bytes would still be kept for as a use of the space.
  await env.DB.prepare(
    "update notes set size = 0, hash = '', paper = null, deleted_at = null where id = ?",
  )
    .bind(note.id)
    .run()

  // And what is named by the note's id outside the row: its room, which holds the
  // whole document for as long as the file does, emptied from `leftovers` like an
  // account's (leftovers.ts); and a chat its `.chat` file opened, which ends now and
  // is erased a month later (chats/sweep.ts). The row stays as a tombstone, so the
  // id is still this note's and nobody else may make anything under it.
  const at = now()
  await env.DB.batch([
    // And the blobs it used, so the owner stops paying for whichever nothing else of
    // theirs still shows (unused.ts).
    noteUnused(env, note.space_id, used, at),
    env.DB.prepare('insert or ignore into leftovers (what, since) values (?, ?)').bind(
      `rooms/${note.id}`,
      at,
    ),
    env.DB.prepare('update chats set ended_at = ? where file_id = ? and ended_at is null').bind(
      at,
      note.id,
    ),
  ])

  // And whatever was shared about this one file. A share about a note whose
  // words have gone reaches nothing - every read of one joins the live note -
  // but a row nobody can ever use is a row nothing would take away, and it is
  // what a listing and a ceiling still count. See spaces/share.ts.
  const guests = await guestsOf(env, note.space_id, note.id)
  await env.DB.batch([
    env.DB.prepare('delete from space_members where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from space_links where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from space_requests where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from guest_members where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
  ])
  for (const guest of guests) await forgetEmptyGuest(env, guest)
}

/** The guests one share of a space reaches, read before its rows go: a guest that
 *  was in nothing else is nobody afterwards, and its session goes with it. */
async function guestsOf(env: Env, spaceId: string, item: string | null): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `select distinct guest_id from guest_members
      where space_id = ?1 and (?2 is null or item = ?2) limit 1000`,
  )
    .bind(spaceId, item)
    .all<{ guest_id: string }>()
  return results.map((one) => one.guest_id)
}

/** Empties a space for good, a batch of notes at a time. The row stays as the
 *  marker a machine that was away reads, and stops being listed once the last
 *  note has gone.
 *
 *  Only the rows whose bytes went are taken away. Deleting every row after one
 *  batch of R2 deletes left the notes past the batch with nothing pointing at
 *  them: bytes in the bucket, no row to find them by, and the space no longer
 *  listed as having anything to purge. `deleted_at` stays set while there is more,
 *  which is what brings the next tap of the button, or the next night's run, back
 *  here to finish. */
async function purgeSpace(env: Env, space: Pick<Space, 'id'>, budget = AT_ONCE): Promise<number> {
  const take = Math.max(0, Math.min(budget, AT_ONCE))
  if (!take) return 0

  const { results } = await env.DB.prepare('select id from notes where space_id = ? limit ?')
    .bind(space.id, take)
    .all<{ id: string }>()

  // The note's words and the snapshot of its document, in one delete apiece.
  await Promise.all(
    results.map((note) => env.NOTES.delete([noteKey(space.id, note.id), snapshotKey(note.id)])),
  )

  // Exactly the rows whose bytes have gone, so nothing rejected above is left
  // recorded as purged. A chunk at a time, because a batch is five hundred notes
  // and D1 binds a hundred parameters; see src/bound.ts.
  //
  // Each chunk writes down, with the rows, what the note's id names outside them:
  // its room, and the bodies of its versions, which go once no other row names the
  // same hash - emptied from `leftovers` as an account's are. And the id itself is
  // retired, so that no create anywhere is made under it again and handed what the
  // room held (0052).
  const at = now()
  for (const chunk of chunks(results.map((note) => note.id))) {
    const list = places(chunk.length)
    await env.DB.batch([
      // The blobs those notes used, written down for their owner before the rows that
      // say so go: files of the tree, papers and the pictures written down for each
      // body (unused.ts). A note written before its pictures were is not read for them
      // here, because a batch of five hundred bodies is too much to read: its pictures
      // stay counted, which costs the owner storage and loses nothing.
      env.DB.prepare(
        `insert or ignore into unused_blobs (user_id, hash, since)
           select sp.user_id, used.hash, ?2 from (
             select space_id, hash from notes
              where id in (select value from json_each(?1)) and kind = 'file' and hash != ''
             union
             select space_id, paper from notes
              where id in (select value from json_each(?1)) and paper is not null
             union
             select n.space_id, p.hash from note_pictures p join notes n on n.id = p.note_id
              where p.note_id in (select value from json_each(?1))
           ) used join spaces sp on sp.id = used.space_id`,
      ).bind(JSON.stringify(chunk), at),
      env.DB.prepare(
        `insert or ignore into leftovers (what, since)
           select 'rooms/' || id, ? from notes where id in (${list})`,
      ).bind(at, ...chunk),
      env.DB.prepare(
        `insert or ignore into leftovers (what, since)
           select distinct 'versions/' || hash, ? from note_versions where note_id in (${list})`,
      ).bind(at, ...chunk),
      env.DB.prepare(
        `insert or ignore into retired_notes (id, since)
           select id, ? from notes where id in (${list})`,
      ).bind(at, ...chunk),
      env.DB.prepare(`delete from notes where id in (${list})`).bind(...chunk),
    ])
  }

  if (results.length < take) {
    // And sync v2's tree of it, which is nothing once the notes have gone. And who it
    // was shared with: the row of a purged space stays as a marker, so nothing
    // cascades from it, and a membership, a link or a guest in a space with nothing
    // in it is a way in to nothing that nothing else would take away. A guest that
    // was in nothing else is nobody now, and its session goes with it. Its chats end
    // with it, and are erased a month later (chats/sweep.ts).
    const guests = await guestsOf(env, space.id, null)
    // And the files it listed and its site's theme, written down for its owner before
    // the marker stops naming them (unused.ts).
    const marker = await env.DB.prepare('select files, site from spaces where id = ?')
      .bind(space.id)
      .first<{ files: string; site: string | null }>()
    const listed = readSpaceFiles(marker?.files ?? '[]').map((one) => one.hash)
    const theme = readSite(marker?.site ?? null).theme?.hash
    await env.DB.batch([
      noteUnused(env, space.id, theme ? [...listed, theme] : listed, at),
      env.DB.prepare('delete from folders where space_id = ?').bind(space.id),
      env.DB.prepare('delete from tree_ops where space_id = ?').bind(space.id),
      env.DB.prepare('delete from space_entries where space_id = ?').bind(space.id),
      env.DB.prepare('delete from space_members where space_id = ?').bind(space.id),
      env.DB.prepare('delete from space_links where space_id = ?').bind(space.id),
      env.DB.prepare('delete from space_requests where space_id = ?').bind(space.id),
      env.DB.prepare('delete from guest_members where space_id = ?').bind(space.id),
      env.DB.prepare('update chats set ended_at = ? where space_id = ? and ended_at is null').bind(
        at,
        space.id,
      ),
      // And the files it listed, which the marker would otherwise still name as the
      // space's own: bytes kept, handed over and counted for a space that is gone.
      env.DB.prepare("update spaces set files = '[]', deleted_at = null where id = ?").bind(
        space.id,
      ),
    ])
    for (const guest of guests) await forgetEmptyGuest(env, guest)
  }

  return results.length
}

/** What the daily job does: everything that has waited its 14 days goes, up to
 *  the batch. Spaces are worked through what is left of the batch after the notes,
 *  because a space holds notes of its own and the ceiling is on the writes rather
 *  than on the rows: five hundred deleted spaces of five hundred notes each is a
 *  quarter of a million writes, which is not something one invocation may do. What
 *  does not fit goes on the next run. */
export async function purgeExpired(
  env: Env,
  at: number,
): Promise<{ notes: number; spaces: number }> {
  const cutoff = at - KEEP_FOR

  const notes = await env.DB.prepare(
    `select id, space_id from notes
      where deleted = 1 and deleted_at is not null and deleted_at < ? limit ?`,
  )
    .bind(cutoff, AT_ONCE)
    .all<Pick<Note, 'id' | 'space_id'>>()
  for (const note of notes.results) await purgeNote(env, note)

  const spaces = await env.DB.prepare(
    `select id from spaces
      where deleted = 1 and deleted_at is not null and deleted_at < ? limit ?`,
  )
    .bind(cutoff, AT_ONCE)
    .all<Pick<Space, 'id'>>()

  let budget = AT_ONCE - notes.results.length
  let emptied = 0
  for (const space of spaces.results) {
    if (budget <= 0) break
    budget -= await purgeSpace(env, space, budget)
    emptied++
  }

  // And the blobs those purges may have left nobody using; see unused.ts.
  await sweepUnused(env, NIGHTLY)

  return { notes: notes.results.length, spaces: emptied }
}

export const trash = new Hono<{ Bindings: Env; Variables: Variables }>()

trash.get('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  const spaces = await deletedSpaces(env, user.id)
  const counted = await Promise.all(
    spaces.map(async (space) => {
      const count = await env.DB.prepare(
        'select count(*) as notes from notes where space_id = ? and deleted = 0',
      )
        .bind(space.id)
        .first<{ notes: number }>()
      return {
        id: space.id,
        name: space.name,
        deletedAt: space.deleted_at,
        purgeAt: (space.deleted_at ?? 0) + KEEP_FOR,
        notes: count?.notes ?? 0,
      }
    }),
  )

  const notes = (await deletedNotes(env, user.id)).map((note) => ({
    id: note.id,
    spaceId: note.space_id,
    spaceName: note.space_name,
    path: note.path,
    deletedAt: note.deleted_at,
    purgeAt: (note.deleted_at ?? 0) + KEEP_FOR,
  }))

  // A listing this long is the batch, not the whole of it. Nobody has held so
  // much in Recently deleted, and saying so is better than pretending.
  const more = counted.length === AT_ONCE || notes.length === AT_ONCE
  if (more) return context.json({ spaces: counted, notes, more })

  return context.json({ spaces: counted, notes })
})

trash.post('/spaces/:id/restore', async (context) => {
  const user = context.get('user')
  const env = context.env
  const space = await deletedSpace(env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to restore' }, 404)

  const live = await env.DB.prepare(
    'select name, position from spaces where user_id = ? and deleted = 0',
  )
    .bind(user.id)
    .all<{ name: string; position: number }>()
  const name = freeName(new Set(live.results.map((one) => one.name)), space.name)
  const position = live.results.reduce((last, one) => Math.max(last, one.position), -1) + 1

  const at = now()
  await env.DB.prepare(
    'update spaces set deleted = 0, deleted_at = null, name = ?, position = ?, updated_at = ? where id = ?',
  )
    .bind(name, position, at, space.id)
    .run()

  return context.json({
    space: presentSpace(
      { ...space, deleted: 0, deleted_at: null, name, position, updated_at: at },
      env,
    ),
  })
})

trash.post('/notes/:id/restore', async (context) => {
  const user = context.get('user')
  const env = context.env
  const note = await deletedNote(env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to restore' }, 404)
  if (note.space_deleted) return context.json({ error: 'restore its space first' }, 409)

  // In a space whose tree is rows, a restore the tree says: the note back where it
  // was, with the folders it was in, numbered if its name was taken meanwhile.
  if (note.name_key) {
    await deleteById(env, note.space_id, await deviceOf(context), note.id, true)
    const back = await env.DB.prepare('select * from notes where id = ?')
      .bind(note.id)
      .first<Note>()
    if (back) return context.json({ note: presentNote(back) })
  }

  const live = await env.DB.prepare('select path from notes where space_id = ? and deleted = 0')
    .bind(note.space_id)
    .all<{ path: string }>()
  const taken = new Set(live.results.map((one) => one.path))
  const path = freePath(note.path, (candidate) => taken.has(candidate))

  const at = now()
  // The number taken and the row written as one; see `atNextSeq`.
  const { seq } = await atNextSeq(
    env,
    note.space_id,
    env.DB.prepare(
      `update notes set deleted = 0, deleted_at = null, path = ?2, seq = ${TAKEN_SEQ},
                        version = version + 1, updated_at = ?3
        where id = ?4`,
    ).bind(note.space_id, path, at, note.id),
  )

  return context.json({
    note: presentNote({
      ...note,
      deleted: 0,
      deleted_at: null,
      path,
      seq,
      version: note.version + 1,
      updated_at: at,
    }),
  })
})

trash.delete('/notes/:id', async (context) => {
  const user = context.get('user')
  const note = await deletedNote(context.env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to delete' }, 404)

  await purgeNote(context.env, note)
  await sweepUnused(context.env, RIGHT_AFTER, user.id)
  return context.json({ ok: true })
})

trash.delete('/spaces/:id', async (context) => {
  const user = context.get('user')
  const space = await deletedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to delete' }, 404)

  await purgeSpace(context.env, space)
  await sweepUnused(context.env, RIGHT_AFTER, user.id)
  return context.json({ ok: true })
})

/** Empties the account's Recently deleted now, a batch at a time. Purging is
 *  idempotent, so a second tap finishes what a first left - and the batch is
 *  counted in writes rather than in rows, for the reason `purgeExpired` gives. */
trash.delete('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  const notes = await deletedNotes(env, user.id)
  for (const note of notes) await purgeNote(env, note)

  let budget = AT_ONCE - notes.length
  for (const space of await deletedSpaces(env, user.id)) {
    if (budget <= 0) break
    budget -= await purgeSpace(env, space, budget)
  }
  await sweepUnused(env, RIGHT_AFTER, user.id)

  return context.json({ ok: true })
})
