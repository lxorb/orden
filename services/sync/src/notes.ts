import { Hono } from 'hono'
import { fits } from './storage'
import { newId, now, sha256 } from './crypto'
import { ownedSpace } from './spaces'
import type { Env, Note, Variables } from './types'

const MAX_BYTES = 4 * 1024 * 1024
const PATH_LIMIT = 400

/** Paths are relative, forward-slashed and end in `.md`. Nothing escapes the space. */
export function cleanPath(input: string): string | null {
  const path = input.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!path || path.length > PATH_LIMIT) return null
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!/\.(md|markdown|mdown|mkd)$/i.test(path)) return null

  return path
}

export function key(spaceId: string, noteId: string): string {
  return `spaces/${spaceId}/${noteId}`
}

/** The next cursor value for a space. Strictly increasing, so a client can ask
 *  for "everything after N" and never miss a write that shared a millisecond. */
export async function nextSeq(env: Env, spaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `insert into space_cursor (space_id, next) values (?, 2)
     on conflict(space_id) do update set next = next + 1
     returning next - 1 as seq`,
  )
    .bind(spaceId)
    .first<{ seq: number }>()

  return row?.seq ?? 1
}

export function presentNote(note: Note) {
  return {
    id: note.id,
    path: note.path,
    seq: note.seq,
    version: note.version,
    updatedAt: note.updated_at,
    deleted: !!note.deleted,
    size: note.size,
    hash: note.hash,
  }
}

export const notes = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Everything that changed since a cursor, tombstones included, so a client
 *  that has been offline can catch up in one round trip. */
notes.get('/spaces/:spaceId/changes', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('spaceId'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  const since = Number(context.req.query('since') ?? 0) || 0
  const { results } = await context.env.DB.prepare(
    'select * from notes where space_id = ? and seq > ? order by seq limit 1000',
  )
    .bind(space.id, since)
    .all<Note>()

  const cursor = results.length ? results[results.length - 1].seq : since
  return context.json({ notes: results.map(presentNote), cursor, more: results.length === 1000 })
})

notes.post('/spaces/:spaceId/notes', async (context) => {
  const user = context.get('user')
  const space = await ownedSpace(context.env, user.id, context.req.param('spaceId'))
  if (!space) return context.json({ error: 'no such space' }, 404)

  const body = await context.req.json<{ path?: string; content?: string }>()
  const path = cleanPath(body.path ?? '')
  const content = body.content ?? ''

  if (!path) return context.json({ error: 'that path is not usable' }, 400)
  if (content.length > MAX_BYTES) return context.json({ error: 'that note is too large' }, 413)

  const existing = await context.env.DB.prepare(
    'select * from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<Note>()

  if (existing) return context.json({ error: 'a note already lives there', note: presentNote(existing) }, 409)

  // A limit nobody enforces is a number on a settings page.
  if (!(await fits(context.env, user.id, content.length))) {
    return context.json({ error: 'out of space' }, 507)
  }

  const note: Note = {
    id: newId(),
    space_id: space.id,
    path,
    seq: await nextSeq(context.env, space.id),
    version: 1,
    updated_at: now(),
    deleted: 0,
    deleted_at: null,
    size: content.length,
    hash: await sha256(content),
  }

  await context.env.NOTES.put(key(space.id, note.id), content)
  await context.env.DB.prepare(
    `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
     values (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      note.id,
      note.space_id,
      note.path,
      note.seq,
      note.version,
      note.updated_at,
      note.size,
      note.hash,
    )
    .run()

  return context.json({ note: presentNote(note) }, 201)
})

async function noteForUser(context: {
  env: Env
  userId: string
  noteId: string
}): Promise<Note | null> {
  const note = await context.env.DB.prepare('select * from notes where id = ?')
    .bind(context.noteId)
    .first<Note>()

  if (!note) return null

  const space = await ownedSpace(context.env, context.userId, note.space_id)
  return space ? note : null
}

notes.get('/notes/:id', async (context) => {
  const note = await noteForUser({
    env: context.env,
    userId: context.get('user').id,
    noteId: context.req.param('id'),
  })

  if (!note) return context.json({ error: 'no such note' }, 404)

  const object = await context.env.NOTES.get(key(note.space_id, note.id))
  return context.json({ note: presentNote(note), content: object ? await object.text() : '' })
})

/** Optimistic concurrency: send the version you edited. A mismatch comes back
 *  as 409 with the server's copy so the client can keep both. */
notes.put('/notes/:id', async (context) => {
  const note = await noteForUser({
    env: context.env,
    userId: context.get('user').id,
    noteId: context.req.param('id'),
  })

  if (!note) return context.json({ error: 'no such note' }, 404)

  const body = await context.req.json<{ path?: string; content?: string; baseVersion?: number }>()
  const content = body.content ?? ''
  if (content.length > MAX_BYTES) return context.json({ error: 'that note is too large' }, 413)

  const path = body.path === undefined ? note.path : cleanPath(body.path)
  if (!path) return context.json({ error: 'that path is not usable' }, 400)

  if (body.baseVersion !== undefined && body.baseVersion !== note.version) {
    const object = await context.env.NOTES.get(key(note.space_id, note.id))
    return context.json(
      {
        error: 'this note changed elsewhere',
        note: presentNote(note),
        content: object ? await object.text() : '',
      },
      409,
    )
  }

  const hash = await sha256(content)
  if (hash === note.hash && path === note.path) return context.json({ note: presentNote(note) })

  // The note's current bytes come back as it is replaced, so editing a large
  // note that stays the same size is never refused.
  if (!(await fits(context.env, context.get('user').id, content.length, note.size))) {
    return context.json({ error: 'out of space' }, 507)
  }

  const updated: Note = {
    ...note,
    path,
    seq: await nextSeq(context.env, note.space_id),
    version: note.version + 1,
    updated_at: now(),
    deleted: 0,
    size: content.length,
    hash,
  }

  await context.env.NOTES.put(key(note.space_id, note.id), content)
  await context.env.DB.prepare(
    'update notes set path = ?, seq = ?, version = ?, updated_at = ?, deleted = 0, size = ?, hash = ? where id = ?',
  )
    .bind(
      updated.path,
      updated.seq,
      updated.version,
      updated.updated_at,
      updated.size,
      updated.hash,
      note.id,
    )
    .run()

  return context.json({ note: presentNote(updated) })
})

/** Soft delete: the tombstone is what tells other devices to remove it. The
 *  content stays, with its size and hash, so the note can be put back from
 *  Recently deleted; the purge in trash.ts takes it away after 14 days. */
notes.delete('/notes/:id', async (context) => {
  const note = await noteForUser({
    env: context.env,
    userId: context.get('user').id,
    noteId: context.req.param('id'),
  })

  if (!note) return context.json({ error: 'no such note' }, 404)

  const at = now()
  await context.env.DB.prepare(
    'update notes set deleted = 1, deleted_at = ?, seq = ?, version = version + 1, updated_at = ? where id = ?',
  )
    .bind(at, await nextSeq(context.env, note.space_id), at, note.id)
    .run()

  return context.json({ ok: true })
})
