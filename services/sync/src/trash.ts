import { Hono } from 'hono'
import { now } from './crypto'
import { key, nextSeq, presentNote } from './notes'
import { presentSpace } from './spaces'
import type { Env, Note, Space, Variables } from './types'

/** How long Recently deleted holds on to something. */
export const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

/** `wanted` if nobody has it, else the first free `wanted 2`, `wanted 3`... -
 *  the numbering the app gives a new space whose name is taken. */
export function freeName(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted
  for (let counter = 2; ; counter++) {
    const candidate = `${wanted} ${counter}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The same for a note path: the number goes before the extension, and the
 *  folder stays where it was. */
export function freePath(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted
  const slash = wanted.lastIndexOf('/')
  const folder = wanted.slice(0, slash + 1)
  const file = wanted.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot) : ''
  for (let counter = 2; ; counter++) {
    const candidate = `${folder}${base} ${counter}${extension}`
    if (!taken.has(candidate)) return candidate
  }
}

type DeletedNote = Note & { space_name: string }

async function deletedSpaces(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    'select * from spaces where user_id = ? and deleted = 1 and deleted_at is not null order by deleted_at desc',
  )
    .bind(userId)
    .all<Space>()
  return results
}

/** Deleted notes of live spaces. A deleted space keeps its notes to itself:
 *  they come back with it, not one by one. */
async function deletedNotes(env: Env, userId: string): Promise<DeletedNote[]> {
  const { results } = await env.DB.prepare(
    `select n.*, s.name as space_name from notes n
       join spaces s on s.id = n.space_id
      where s.user_id = ? and s.deleted = 0 and n.deleted = 1 and n.deleted_at is not null
      order by n.deleted_at desc`,
  )
    .bind(userId)
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

/** Takes a note's content away for good. The row stays as the tombstone the
 *  change feed relies on, and stops being listed. */
export async function purgeNote(env: Env, note: Pick<Note, 'id' | 'space_id'>) {
  await env.NOTES.delete(key(note.space_id, note.id))
  await env.DB.prepare("update notes set size = 0, hash = '', deleted_at = null where id = ?")
    .bind(note.id)
    .run()
}

/** Empties a space for good. The row stays as the marker a machine that was
 *  away reads, and stops being listed. */
export async function purgeSpace(env: Env, space: Pick<Space, 'id'>) {
  const { results } = await env.DB.prepare('select id from notes where space_id = ?')
    .bind(space.id)
    .all<{ id: string }>()
  await Promise.all(results.map((note) => env.NOTES.delete(key(space.id, note.id))))
  await env.DB.prepare('delete from notes where space_id = ?').bind(space.id).run()
  await env.DB.prepare('update spaces set deleted_at = null where id = ?').bind(space.id).run()
}

/** What the daily job does: everything that has waited its 14 days goes. */
export async function purgeExpired(env: Env, at: number): Promise<{ notes: number; spaces: number }> {
  const cutoff = at - KEEP_FOR

  const notes = await env.DB.prepare(
    'select id, space_id from notes where deleted = 1 and deleted_at is not null and deleted_at < ?',
  )
    .bind(cutoff)
    .all<Pick<Note, 'id' | 'space_id'>>()
  for (const note of notes.results) await purgeNote(env, note)

  const spaces = await env.DB.prepare(
    'select id from spaces where deleted = 1 and deleted_at is not null and deleted_at < ?',
  )
    .bind(cutoff)
    .all<Pick<Space, 'id'>>()
  for (const space of spaces.results) await purgeSpace(env, space)

  return { notes: notes.results.length, spaces: spaces.results.length }
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
    space: presentSpace({ ...space, deleted: 0, deleted_at: null, name, position, updated_at: at }, env),
  })
})

trash.post('/notes/:id/restore', async (context) => {
  const user = context.get('user')
  const env = context.env
  const note = await deletedNote(env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to restore' }, 404)
  if (note.space_deleted) return context.json({ error: 'restore its space first' }, 409)

  const live = await env.DB.prepare('select path from notes where space_id = ? and deleted = 0')
    .bind(note.space_id)
    .all<{ path: string }>()
  const path = freePath(new Set(live.results.map((one) => one.path)), note.path)

  const at = now()
  const seq = await nextSeq(env, note.space_id)
  await env.DB.prepare(
    'update notes set deleted = 0, deleted_at = null, path = ?, seq = ?, version = version + 1, updated_at = ? where id = ?',
  )
    .bind(path, seq, at, note.id)
    .run()

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
  return context.json({ ok: true })
})

trash.delete('/spaces/:id', async (context) => {
  const user = context.get('user')
  const space = await deletedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to delete' }, 404)

  await purgeSpace(context.env, space)
  return context.json({ ok: true })
})

/** Empties the account's Recently deleted, all of it, now. */
trash.delete('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  for (const note of await deletedNotes(env, user.id)) await purgeNote(env, note)
  for (const space of await deletedSpaces(env, user.id)) await purgeSpace(env, space)

  return context.json({ ok: true })
})
