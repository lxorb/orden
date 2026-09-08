import { Hono } from 'hono'
import { mergeCanvasFiles } from '@nib/markdown/canvas-merge'
import { isCanvasTarget } from '@nib/markdown/links'
import { readBody } from './body'
import { fits } from './storage'
import { byteLength, newId, now, sha256 } from './crypto'
import { allows, atLeast, refusal, spaceOf, type Reached } from './spaces/space'
import { reachedSpace } from './spaces/space'
import type { Env, Note, User, Variables } from './types'

/** The largest note the API will take. R2 would hold more; a note this size
 *  is already a file that wants to be split, and the ceiling keeps one
 *  request from spending a tenth of an account on itself. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024
export const PATH_LIMIT = 400

/** What a note's path may end in.
 *
 *  A canvas is here beside the markdown extensions because it travels as a note
 *  rather than as a file. The two ways a space's contents reach an account are
 *  this one, which is versioned and comes back down, and the blob list beside it,
 *  which only goes up so that a published page can serve a PDF. A canvas is small
 *  text that is edited on more than one device, so it wants the first: the
 *  version, the hash and the conflict rule are exactly what a file two people
 *  draw on needs. See apps/desktop/src/lib/sync/mirror.ts, which sends every file
 *  that is not a PDF through here. */
const NOTE_PATH = /\.(md|markdown|mdown|mkd|canvas)$/i

/** Paths are relative, forward-slashed and named like a note. Nothing escapes
 *  the space. */
export function cleanPath(input: string): string | null {
  const path = input.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!path || path.length > PATH_LIMIT) return null
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!NOTE_PATH.test(path)) return null

  return path
}

export function noteKey(spaceId: string, noteId: string): string {
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

/** Puts a note in a space that has nothing at that path yet: the bytes in R2,
 *  the row in D1, at the space's next cursor so every other device reads it as
 *  an ordinary arrival. Answers the note as it now stands.
 *
 *  The one place a note comes into being, so the columns a note starts life with
 *  are decided once. Neither the quota nor the path is checked here: what may be
 *  written, and by whom, is the caller's question, and the callers ask it
 *  differently - the route below, the connector, and the note every new account
 *  is given (see spaces/first.ts). */
export async function addNote(
  env: Env,
  spaceId: string,
  path: string,
  content: string,
): Promise<Note> {
  const note: Note = {
    id: newId(),
    space_id: spaceId,
    path,
    seq: await nextSeq(env, spaceId),
    version: 1,
    updated_at: now(),
    deleted: 0,
    deleted_at: null,
    size: byteLength(content),
    hash: await sha256(content),
  }

  await env.NOTES.put(noteKey(spaceId, note.id), content)
  await env.DB.prepare(
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

  return note
}

/** Puts a note's new contents in the store: the bytes in R2, the row in D1, with
 *  the version and the space's cursor moved on so that every other device reads
 *  it as an ordinary save. Answers the note as it now stands, and the note
 *  untouched when the bytes and the path are already what is held.
 *
 *  Shared by the route below and by a room settling what several devices wrote
 *  together (see rooms/room.ts), so a note that arrives either way lands in one
 *  shape and everything that reads notes - the file sync, publishing, the
 *  connector, the glasses, search - carries on unaware there was a difference. */
export async function saveNote(env: Env, note: Note, content: string, path: string): Promise<Note> {
  const size = byteLength(content)
  const hash = await sha256(content)
  if (hash === note.hash && path === note.path) return note

  const updated: Note = {
    ...note,
    path,
    seq: await nextSeq(env, note.space_id),
    version: note.version + 1,
    updated_at: now(),
    deleted: 0,
    size,
    hash,
  }

  await env.NOTES.put(noteKey(note.space_id, note.id), content)
  await env.DB.prepare(
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

  return updated
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
notes.get('/spaces/:spaceId/changes', atLeast('read', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const since = Number(context.req.query('since') ?? 0) || 0
  const { results } = await context.env.DB.prepare(
    'select * from notes where space_id = ? and seq > ? order by seq limit 1000',
  )
    .bind(space.id, since)
    .all<Note>()

  const cursor = results.at(-1)?.seq ?? since
  return context.json({ notes: results.map(presentNote), cursor, more: results.length === 1000 })
})

notes.post('/spaces/:spaceId/notes', atLeast('write', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const given = body.text('path', PATH_LIMIT)
  const sent = body.text('content', MAX_NOTE_BYTES)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const path = cleanPath(given ?? '')
  const content = sent ?? ''
  const size = byteLength(content)

  if (!path) return context.json({ error: 'that path is not usable' }, 400)
  if (size > MAX_NOTE_BYTES) return context.json({ error: 'that note is too large' }, 413)

  const existing = await context.env.DB.prepare(
    'select * from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<Note>()

  if (existing)
    return context.json({ error: 'a note already lives there', note: presentNote(existing) }, 409)

  // A limit nobody enforces is a number on a settings page. Counted against
  // whoever owns the space rather than whoever is writing: the bytes land in
  // their storage, so it is their quota the note has to fit inside.
  if (!(await fits(context.env, space.user_id, size))) {
    return context.json({ error: 'out of space' }, 507)
  }

  const note = await addNote(context.env, space.id, path, content)

  return context.json({ note: presentNote(note) }, 201)
})

/** A note this account can reach, together with the space it sits in and the
 *  role held there. Null when the note is not there or is in a space this
 *  account has nothing to do with, which are the same answer on purpose. */
async function reachedNote(
  env: Env,
  user: User,
  noteId: string,
): Promise<{ note: Note; space: Reached } | null> {
  const note = await env.DB.prepare('select * from notes where id = ?').bind(noteId).first<Note>()

  if (!note) return null

  const space = await reachedSpace(env, user, note.space_id)
  return space ? { note, space } : null
}

notes.get('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('user'), context.req.param('id'))
  if (!found) return context.json({ error: 'no such note' }, 404)
  const { note } = found

  const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
  return context.json({ note: presentNote(note), content: object ? await object.text() : '' })
})

/** Optimistic concurrency: send the version you edited.
 *
 *  A mismatch on a note comes back as 409 with the server's copy, so the client
 *  can keep both: two people typing in one paragraph is not something a machine
 *  can settle.
 *
 *  A mismatch on a canvas is settled here instead. Everything on a canvas has an
 *  id and a time of its own, so the union of the two copies keeps every card and
 *  every stroke either device drew, and the same merge runs on the client; see
 *  packages/markdown/src/canvas-merge.ts. Two tablets drawing on one plane at the
 *  same time therefore both keep what they drew, and neither ends up with a
 *  second file to go and find. */
notes.put('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('user'), context.req.param('id'))
  if (!found) return context.json({ error: 'no such note' }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  const { note, space } = found

  const body = await readBody(context)
  const given = body.text('path', PATH_LIMIT)
  const sent = body.text('content', MAX_NOTE_BYTES)
  const baseVersion = body.count('baseVersion')
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (byteLength(sent ?? '') > MAX_NOTE_BYTES) {
    return context.json({ error: 'that note is too large' }, 413)
  }

  const path = given === undefined ? note.path : cleanPath(given)
  if (!path) return context.json({ error: 'that path is not usable' }, 400)

  // Reassigned when a canvas has to be put back together with the copy the
  // server already holds; see the note above.
  let content = sent ?? ''

  if (baseVersion !== undefined && baseVersion !== note.version) {
    const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
    const held = object ? await object.text() : ''

    if (!isCanvasTarget(path)) {
      return context.json(
        { error: 'this note changed elsewhere', note: presentNote(note), content: held },
        409,
      )
    }

    content = mergeCanvasFiles(content, held)
    if (byteLength(content) > MAX_NOTE_BYTES) {
      return context.json({ error: 'that note is too large' }, 413)
    }
  }

  // The note's current bytes come back as it is replaced, so editing a large
  // note that stays the same size is never refused. Against the space's owner,
  // for the same reason as above.
  if (!(await fits(context.env, space.user_id, byteLength(content), note.size))) {
    return context.json({ error: 'out of space' }, 507)
  }

  return context.json({ note: presentNote(await saveNote(context.env, note, content, path)) })
})

/** Soft delete: the tombstone is what tells other devices to remove it. The
 *  content stays, with its size and hash, so the note can be put back from
 *  Recently deleted; the purge in trash.ts takes it away after 14 days. */
notes.delete('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('user'), context.req.param('id'))
  if (!found) return context.json({ error: 'no such note' }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  const { note } = found

  const at = now()
  await context.env.DB.prepare(
    'update notes set deleted = 1, deleted_at = ?, seq = ?, version = version + 1, updated_at = ? where id = ?',
  )
    .bind(at, await nextSeq(context.env, note.space_id), at, note.id)
    .run()

  return context.json({ ok: true })
})
