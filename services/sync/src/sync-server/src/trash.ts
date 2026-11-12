import { Hono } from 'hono'
import { chunks, places } from './bound'
import { now } from './crypto'
import { note as noted } from './failed'
import { wordsLeftover } from './leftovers'
import { noteKey, presentNote, restoreNote, takeSeq } from './notes'
import { eraseRooms } from './rooms'
import { snapshotKey } from './rooms/epoch'
import { deviceOf } from './sync2/device'
import { MOST_OWN_SPACES, presentSpace, TOO_MANY_SPACES } from './spaces/space'
import type { Env, Note, Space, Variables } from './types'
import { forgetWords } from './site/words'
import { forgetReminders } from './push/reminders'
import { forgetPictures, htmlIsLive, picturesOf } from './pictures'
import { forgetBodies, forgetVersions } from './versions'
import { noteChatFiles, noteUnused, RIGHT_AFTER, NIGHTLY, sweepUnused } from './unused'
import { readSpaceFiles } from './spaces/files'
import { readSite } from './site/site'
import { FRONT_REV } from './site/front'
import { forgetEmptyGuest } from './guests'
import { type Ended, hooks } from './hooks'

const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

export const AT_ONCE = 500

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
    const live = await htmlIsLive(env, note.space_id)
    for (const hash of picturesOf(object ? await object.text() : '', live)) used.add(hash)
  }
  return used
}

async function purgeNote(
  env: Env,
  note: Pick<Note, 'id' | 'space_id'>,
  who: string | null,
): Promise<boolean> {
  const used = await usedBy(env, note)
  const guests = await guestsOf(env, note.space_id, note.id)

  const at = now()
  const objects = [noteKey(note.space_id, note.id), snapshotKey(note.id)]
  const leftover = (what: string) =>
    env.DB.prepare('insert or ignore into leftovers (what, since) values (?, ?)').bind(what, at)
  const versions = forgetVersions(env, note.id)
  const terms = hooks().machines.endingTerm(env, note.id, at)

  const statements = [
    takeSeq(env, note.space_id),
    env.DB.prepare(
      `insert into space_cursor (space_id, next)
       select ?1, 0 where not exists (
         select 1 from notes
          where space_id = ?1 and id = ?2 and deleted = 1 and deleted_at is not null)`,
    ).bind(note.space_id, note.id),
    ...objects.map(leftover),
    env.DB.prepare(
      `insert or ignore into leftovers (what, since)
         select distinct 'versions/' || hash, ?2 from note_versions where note_id = ?1`,
    ).bind(note.id, at),
    versions,
    leftover(wordsLeftover(note.id)),
    forgetReminders(env, note.id),
    forgetPictures(env, note.id),
    env.DB.prepare(
      "update notes set size = 0, hash = '', paper = null, deleted_at = null where id = ?",
    ).bind(note.id),
    ...noteUnused(env, note.space_id, used, at),
    leftover(`rooms/${note.id}`),
    env.DB.prepare('update chats set ended_at = ? where file_id = ? and ended_at is null').bind(
      at,
      note.id,
    ),
    env.DB.prepare('delete from form_answers where note_id = ?').bind(note.id),
    env.DB.prepare('delete from blog_paths where note_id = ?').bind(note.id),
    terms,
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
    env.DB.prepare('delete from once_shared where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare(
      `delete from guests where id in (select value from json_each(?))
          and not exists (select 1 from guest_members where guest_id = guests.id)`,
    ).bind(JSON.stringify(guests)),
  ]
  let answers: D1Result[]
  try {
    answers = await env.DB.batch(statements)
  } catch (error) {
    const still = await env.DB.prepare(
      'select 1 as one from notes where id = ? and deleted = 1 and deleted_at is not null',
    )
      .bind(note.id)
      .first()
    if (still) throw error
    return false
  }
  if (!(answers as { success: boolean }[]).every((one) => one.success)) {
    throw new Error(`purge ${note.id} did not land`)
  }

  const later = (error: unknown) => {
    noted(`purge ${note.id}`, error, null)
  }
  await env.NOTES.delete(objects).catch(later)
  const answerOf = <T>(statement: D1PreparedStatement) =>
    (answers[statements.indexOf(statement)]?.results ?? []) as T[]
  await forgetBodies(
    env,
    answerOf<{ hash: string }>(versions).map((one) => one.hash),
  ).catch(later)
  await hooks().machines.tellEnded(env, answerOf<Ended>(terms), who).catch(later)
  await eraseRooms(env, [note.id]).catch(later)
  await env.DB.batch([
    forgetWords(env, note.id),
    env.DB.prepare('delete from leftovers where what = ?').bind(wordsLeftover(note.id)),
  ]).catch(later)
  return true
}

async function guestsOf(env: Env, spaceId: string, item: string | null): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `select distinct guest_id from guest_members
      where space_id = ?1 and (?2 is null or item = ?2) limit 1000`,
  )
    .bind(spaceId, item)
    .all<{ guest_id: string }>()
  return results.map((one) => one.guest_id)
}

async function purgeSpace(
  env: Env,
  space: Pick<Space, 'id'>,
  who: string | null,
  budget = AT_ONCE,
): Promise<number> {
  const take = Math.max(0, Math.min(budget, AT_ONCE))
  if (!take) return 0

  const { results } = await env.DB.prepare('select id from notes where space_id = ? limit ?')
    .bind(space.id, take)
    .all<{ id: string }>()

  await Promise.all(
    results.map((note) => env.NOTES.delete([noteKey(space.id, note.id), snapshotKey(note.id)])),
  )

  const at = now()
  for (const chunk of chunks(results.map((note) => note.id))) {
    await hooks().machines.endTerms(env, chunk, who)
    const list = places(chunk.length)
    await env.DB.batch([
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
      env.DB.prepare(`delete from note_search where note_id in (${list})`).bind(...chunk),
      env.DB.prepare(`delete from push_reminders where note_id in (${list})`).bind(...chunk),
      env.DB.prepare(`delete from notes where id in (${list})`).bind(...chunk),
    ])
  }

  if (results.length < take) {
    const guests = await guestsOf(env, space.id, null)
    const marker = await env.DB.prepare('select files, site from spaces where id = ?')
      .bind(space.id)
      .first<{ files: string; site: string | null }>()
    const listed = readSpaceFiles(marker?.files ?? '[]').map((one) => one.hash)
    const theme = readSite(marker?.site ?? null).theme?.hash
    await env.DB.batch([
      ...noteUnused(env, space.id, theme ? [...listed, theme] : listed, at),
      noteChatFiles(env, 'c.space_id = ?2', at, space.id),
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
      env.DB.prepare("update spaces set files = '[]', deleted_at = null where id = ?").bind(
        space.id,
      ),
    ])
    for (const guest of guests) await forgetEmptyGuest(env, guest)
  }

  return results.length
}

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
  for (const note of notes.results) {
    await purgeNote(env, note, null).catch((error: unknown) => {
      noted(`purge ${note.id}`, error, null)
    })
  }

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
    budget -= await purgeSpace(env, space, null, budget)
    emptied++
  }

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
  const back = await env.DB.prepare(
    `update spaces set deleted = 0, deleted_at = null, name = ?1, position = ?2, updated_at = ?3
      where id = ?4
        and (select count(*) from spaces where user_id = ?5 and deleted = 0) < ?6`,
  )
    .bind(name, position, at, space.id, user.id, MOST_OWN_SPACES)
    .run()
  if (!back.meta.changes) return context.json({ error: TOO_MANY_SPACES }, 409)

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

  const back = await restoreNote(env, note, await deviceOf(context))
  if (back.deleted) return context.json({ error: 'nothing to restore' }, 404)
  return context.json({ note: presentNote(back) })
})

trash.delete('/notes/:id', async (context) => {
  const user = context.get('user')
  const note = await deletedNote(context.env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to delete' }, 404)

  if (!(await purgeNote(context.env, note, user.id))) {
    return context.json({ error: 'nothing to delete' }, 404)
  }
  await sweepUnused(context.env, RIGHT_AFTER, user.id).catch((error: unknown) => {
    noted('purge sweep', error, null)
  })
  return context.json({ ok: true })
})

trash.delete('/spaces/:id', async (context) => {
  const user = context.get('user')
  const space = await deletedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to delete' }, 404)

  await purgeSpace(context.env, space, user.id)
  await sweepUnused(context.env, RIGHT_AFTER, user.id)
  return context.json({ ok: true })
})

trash.delete('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  const notes = await deletedNotes(env, user.id)
  const failures: unknown[] = []
  for (const note of notes) {
    await purgeNote(env, note, user.id).catch((error: unknown) => failures.push(error))
  }

  let budget = AT_ONCE - notes.length
  for (const space of await deletedSpaces(env, user.id)) {
    if (budget <= 0) break
    budget -= await purgeSpace(env, space, user.id, budget)
  }
  await sweepUnused(env, RIGHT_AFTER, user.id)

  if (failures.length) throw failures[0]
  return context.json({ ok: true })
})
