import { type Context, Hono } from 'hono'
import { NOT_A_PATH, NO_SUCH_NOTE, OUT_OF_SPACE, ROOM_AWAY } from './refused'
import { mergeCanvasFiles } from '@orden/markdown/canvas-merge'
import { metaText, isName, LONGEST_NAME, shortened, type ItemMeta } from '@orden/sync-core'
import { isPagesTarget } from '@orden/markdown/links'
import { conflictPath, freePath, numbered } from '@orden/markdown/paths'
import { objectBody, readBody } from './body'
import { FRONT_REV, readFront, titleFrom, writeFront } from './blog/front'
import { rememberOldPaths } from './blog/paths'
import { keepWords } from './blog/words'
import { linkPointer } from './chats/pointer'
import { keepPictures } from './pictures'
import { keepReminders } from './push/reminders'
import { fits } from './storage'
import { byteLength, newId, now, sha256 } from './crypto'
import {
  allows,
  atLeast,
  reachedItem,
  reachedSpace,
  refusal,
  spaceOf,
  type Reached,
} from './spaces/space'
import { laterOf, pokeSpace } from './hub/poke'
import { ingestInto } from './rooms'
import { noteKind, readsAs } from './rooms/kind'
import { deviceOf } from './sync2/device'
import { createByPath, deleteById, moveByPath } from './sync2/ops'
import { DOCUMENT_KINDS, kindOfName } from './sync2/tree'
import type { Env, Note, Variables, Whoever } from './types'
import {
  countVersionsAt,
  deviceIn,
  holdVersion,
  keepVersion,
  ROLLBACK_AT_ONCE,
  presentVersion,
  saidAs,
  saidOnce,
  versionAt,
  versionsAt,
  versionsOf,
  versionKey,
} from './versions'
import { said } from './said'

const TOO_LARGE = 'that note is too large'

export const MAX_NOTE_BYTES = 4 * 1024 * 1024
export const PATH_LIMIT = 400

const HIDDEN_FROM_V1: ReadonlySet<string> = new Set(['file', 'term'])
const V1_HIDDEN = "('file', 'term')"

const NOTE_PATH = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc|chat)$/i

export function readablePath(input: string): string | null {
  const path = input.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!path || path.length > PATH_LIMIT) return null
  if (/\p{Cc}/u.test(path)) return null
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!NOTE_PATH.test(path)) return null

  return path
}

export function cleanPath(input: string): string | null {
  const path = readablePath(input)
  return path?.split('/').every(isName) ? path : null
}

export function noteKey(spaceId: string, noteId: string): string {
  return `spaces/${spaceId}/${noteId}`
}

export const TAKEN_SEQ = '(select next - 1 from space_cursor where space_id = ?1)'

export function placedOn(words: string): string {
  const now = `${words} and (doc_seq is null or seq <> doc_seq or placed_seq is null)`
  return `placed_seq = case when ${now} then seq else placed_seq end,
          placed_by = case when ${now} then updated_by else placed_by end`
}

const PLACED_ON_WORDS = placedOn('?9')

export function changesBy(device: string): string {
  return `changes_by = case when ${device} is null then changes_by
            else json_patch(coalesce(changes_by, '{}'), json_object(${device}, ${TAKEN_SEQ})) end`
}

export function takeSeq(env: Env, spaceId: string): D1PreparedStatement {
  return env.DB.prepare(
    `insert into space_cursor (space_id, next) values (?1, 2)
     on conflict(space_id) do update set next = next + 1`,
  ).bind(spaceId)
}

export async function atNextSeq(
  env: Env,
  spaceId: string,
  write: D1PreparedStatement,
): Promise<{ seq: number; changes: number }> {
  const [, written, taken] = await env.DB.batch([
    takeSeq(env, spaceId),
    write,
    env.DB.prepare('select next - 1 as seq from space_cursor where space_id = ?1').bind(spaceId),
  ])
  const seq = (taken?.results[0] as { seq?: number } | undefined)?.seq ?? 1
  return { seq, changes: written?.meta.changes ?? 0 }
}

export async function addNote(
  env: Env,
  spaceId: string,
  path: string,
  content: string,
  by = '',
  device?: string,
  meta?: ItemMeta,
): Promise<Note> {
  const space = await env.DB.prepare('select prepared_at from spaces where id = ?')
    .bind(spaceId)
    .first<{ prepared_at: number | null }>()
  if (space?.prepared_at) return await placeNote(env, spaceId, path, content, by, device, meta)

  const note: Note = {
    id: newId(),
    space_id: spaceId,
    path,
    seq: 0,
    version: 1,
    updated_at: now(),
    deleted: 0,
    deleted_at: null,
    size: byteLength(content),
    hash: await sha256(content),
    front: writeFront(content),
    meta: metaText(meta),
  }

  note.seq = (
    await atNextSeq(
      env,
      spaceId,
      env.DB.prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, front,
                            front_rev, meta)
         values (?2, ?1, ?3, ${TAKEN_SEQ}, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        note.space_id,
        note.id,
        note.path,
        note.version,
        note.updated_at,
        note.size,
        note.hash,
        note.front,
        FRONT_REV,
        note.meta,
      ),
    )
  ).seq

  await env.NOTES.put(noteKey(spaceId, note.id), content)

  await keepVersion(env, note, content, by).catch(() => undefined)

  await keepWords(env, note, content, titleFrom(note.path, content)).catch(() => undefined)
  await keepPictures(env, note, content)
  await keepReminders(env, note, content).catch(() => undefined)
  await linkPointer(env, note, content).catch(() => undefined)

  return note
}

async function placeNote(
  env: Env,
  spaceId: string,
  path: string,
  content: string,
  by: string,
  device: string | undefined,
  meta: ItemMeta | undefined,
): Promise<Note> {
  const hash = await sha256(content)
  const document = DOCUMENT_KINDS.has(kindOfName(path))
  const placed = await createByPath(
    env,
    spaceId,
    device,
    path,
    {
      hash,
      size: byteLength(content),
      front: writeFront(content),
      epoch: document ? 1 : 0,
      epochBase: document ? hash : null,
    },
    meta,
  )
  if ('taken' in placed) throw new NoteTaken(placed.taken)

  const note = await env.DB.prepare('select * from notes where id = ?')
    .bind(placed.made)
    .first<Note>()
  if (!note) throw new Error('a note made in the tree is not there')

  await env.NOTES.put(noteKey(spaceId, note.id), content)
  await keepVersion(env, note, content, by).catch(() => undefined)
  await keepWords(env, note, content, titleFrom(note.path, content)).catch(() => undefined)
  await keepPictures(env, note, content)
  await keepReminders(env, note, content).catch(() => undefined)
  await linkPointer(env, note, content).catch(() => undefined)
  return note
}

export class NoteTaken extends Error {
  constructor(readonly id: string) {
    super('a note already lives there')
  }
}

function noteAt(env: Env, spaceId: string, path: string): Promise<Note | null> {
  return env.DB.prepare('select * from notes where space_id = ? and path = ? and deleted = 0')
    .bind(spaceId, path)
    .first<Note>()
}

export async function noteBeside(
  env: Env,
  note: Note,
  content: string,
  by = '',
): Promise<Note | null> {
  const hash = await sha256(content)
  const kept = await env.DB.prepare(
    'select * from notes where space_id = ? and hash = ? and id != ? and deleted = 0',
  )
    .bind(note.space_id, hash, note.id)
    .first<Note>()

  if (kept) return kept

  const beside = besidePath(note.path)

  for (let counter = 1; counter <= 20; counter += 1) {
    const path = numbered(beside, counter)
    if (await noteAt(env, note.space_id, path)) continue

    return await addNote(env, note.space_id, path, content, by)
  }

  return null
}

function besidePath(path: string): string {
  const parts = path.split('/')
  const name = parts.pop() ?? path
  const place = parts.every(isName) ? parts : []
  const made = (named: string) => conflictPath([...place, named].join('/'))
  const over = nameLength(made(name)) + ' 20'.length - LONGEST_NAME
  return over <= 0 ? made(name) : made(shortened(name, over, 'note'))
}

const nameLength = (path: string) => path.length - path.lastIndexOf('/') - 1

export interface Saving {
  docBy?: string
  epoch?: number
  versionBy?: string
}

export async function saveNote(
  env: Env,
  note: Note,
  content: string,
  path: string,
  by = '',
  saving: Saving = {},
): Promise<Note | null> {
  const size = byteLength(content)
  const hash = await sha256(content)
  if (hash === note.hash && path === note.path) return note

  const words = hash !== note.hash
  const updated: Note = {
    ...note,
    path,
    seq: 0,
    version: note.version + 1,
    updated_at: now(),
    deleted: 0,
    size,
    hash,
    front: writeFront(content),
    doc_seq: words ? 0 : (note.doc_seq ?? null),
    doc_by: words ? (saving.docBy ?? null) : (note.doc_by ?? null),
    updated_by: saving.docBy ?? null,
  }

  const written = await atNextSeq(
    env,
    note.space_id,
    env.DB.prepare(
      `update notes set path = ?2, seq = ${TAKEN_SEQ}, version = ?3, updated_at = ?4, deleted = 0,
                        size = ?5, hash = ?6, front = ?7, front_rev = ?8,
                        doc_seq = case when ?9 then ${TAKEN_SEQ} else ?10 end, doc_by = ?11,
                        updated_by = ?12, ${changesBy('?12')},
                        ${PLACED_ON_WORDS}
        where id = ?13 and version = ?14 and epoch = ?15`,
    ).bind(
      note.space_id,
      updated.path,
      updated.version,
      updated.updated_at,
      updated.size,
      updated.hash,
      updated.front,
      FRONT_REV,
      words ? 1 : 0,
      note.doc_seq ?? null,
      updated.doc_by ?? null,
      updated.updated_by ?? null,
      note.id,
      note.version,
      saving.epoch ?? note.epoch ?? 0,
    ),
  )

  if (!written.changes) return null
  updated.seq = written.seq
  if (words) updated.doc_seq = written.seq

  await env.NOTES.put(noteKey(note.space_id, note.id), content)

  await keepVersion(env, updated, content, by, saving.docBy ?? saving.versionBy ?? null).catch(
    () => undefined,
  )

  await rememberOldPaths(env, note, path, readFront(updated.front)).catch(() => undefined)
  await keepWords(env, updated, content, titleFrom(path, content)).catch(() => undefined)
  await keepPictures(env, updated, content)
  await keepReminders(env, updated, content).catch(() => undefined)
  await linkPointer(env, updated, content).catch(() => undefined)

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

notes.get('/spaces/:spaceId/changes', atLeast('read', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0

  const { results } = await context.env.DB.prepare(
    `select * from notes where space_id = ? and seq > ? and kind not in ${V1_HIDDEN}
      order by seq limit 1000`,
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

  if (!path) return context.json({ error: NOT_A_PATH }, 400)
  if (size > MAX_NOTE_BYTES) return context.json({ error: TOO_LARGE }, 413)

  const taken = await noteAt(context.env, space.id, path)
  if (taken) return await alreadyThere(context, taken)

  if (!(await fits(context.env, space.user_id, size))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const device = await deviceOf(context)
  let note: Note
  try {
    note = await addNote(
      context.env,
      space.id,
      path,
      content,
      deviceIn(said((name) => context.req.header(name), 'device')),
      device,
    )
  } catch (error) {
    const won =
      error instanceof NoteTaken
        ? await noteById(context.env, error.id)
        : await noteAt(context.env, space.id, path)
    if (!won) throw error

    return await alreadyThere(context, won)
  }

  await pokeSpace(context.env, laterOf(context), space.id, note.seq, device)
  return context.json({ note: presentNote(note) }, 201)
})

async function alreadyThere(
  context: Context<{ Bindings: Env; Variables: Variables }>,
  note: Note,
): Promise<Response> {
  const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
  return context.json(
    {
      error: 'a note already lives there',
      note: presentNote(note),
      content: object ? await object.text() : '',
    },
    409,
  )
}

async function reachedNote(
  env: Env,
  who: Whoever,
  noteId: string,
): Promise<{ note: Note; space: Reached; only: boolean } | null> {
  const note = await noteById(env, noteId)

  if (!note || HIDDEN_FROM_V1.has(note.kind ?? 'note')) return null

  if (note.deleted && note.deleted_at === null) return null

  const space = await reachedSpace(env, who, note.space_id)
  if (space) return { note, space, only: false }
  if (note.deleted) return null

  const item = await reachedItem(env, who, note)
  return item ? { note, space: item, only: true } : null
}

notes.get('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  const { note } = found

  const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
  return context.json({ note: presentNote(note), content: object ? await object.text() : '' })
})

notes.get('/notes/:id/versions', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const held = await versionsOf(context.env, found.note.id)
  return context.json({ versions: held.map(presentVersion) })
})

notes.get('/notes/:id/versions/:at', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const asked = Math.floor(Number(context.req.param('at')))
  const content = Number.isFinite(asked) ? await versionAt(context.env, found.note.id, asked) : null

  if (content === null) return context.json({ error: 'no such version' }, 404)
  return context.json({ at: asked, content })
})

notes.get('/notes/:id/paper', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const hash = found.note.paper
  const object = hash ? await context.env.NOTES.get(`blobs/${hash}`) : null
  if (!hash || !object) return context.json({ error: NO_PAPER }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(object.size),
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})

notes.put('/notes/:id/paper', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found || found.note.deleted) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (found.only || !allows(found.space.role, 'write')) {
    return context.json({ error: refusal('write') }, 403)
  }
  const { note, space } = found
  if (!isPagesTarget(note.path)) return context.json({ error: NOT_PAGES }, 400)

  const body = await readBody(context)
  const hash = body.text('hash', 64)?.toLowerCase()
  if (body.problem || !hash || !PAPER_HASH.test(hash)) {
    return context.json({ error: 'that is not a hash' }, 400)
  }

  const who = context.get('who')
  const kept = await context.env.DB.prepare(
    `select 1 as one from blobs
      where hash = ?1
        and (user_id = ?2
             or (user_id = ?3
                 and (exists (select 1 from notes where space_id = ?4
                                and (paper = ?1 or (kind = 'file' and hash = ?1)))
                      or exists (select 1 from spaces s, json_each(s.files) f
                                  where s.id = ?4 and json_extract(f.value, '$.hash') = ?1))))
      limit 1`,
  )
    .bind(hash, who.kind === 'user' ? who.user.id : '', space.user_id, space.id)
    .first<{ one: number }>()
  if (!kept) return context.json({ error: NO_PAPER }, 409)

  if (note.paper !== hash) {
    await context.env.DB.prepare('update notes set paper = ? where id = ?')
      .bind(hash, note.id)
      .run()
  }
  return context.json({ paper: hash })
})

const PAPER_HASH = /^[a-f0-9]{64}$/
const NO_PAPER = 'this note holds no paper'
const NOT_PAGES = 'only a page note holds a paper'

export const MOST_ASKED = 100

notes.post('/notes/said', async (context) => {
  const body = await objectBody(context)
  const asked = Array.isArray(body?.notes) ? body.notes : null
  if (!asked || asked.length > MOST_ASKED) return context.json({ error: 'which notes' }, 400)

  const said: string[] = []
  for (const one of asked) {
    const note = one as { id?: unknown; hash?: unknown } | null
    if (typeof note?.id !== 'string' || typeof note.hash !== 'string') {
      return context.json({ error: 'which notes' }, 400)
    }
    const found = await reachedNote(context.env, context.get('who'), note.id)
    if (found && (await saidOnce(context.env, found.note, note.hash))) said.push(note.id)
  }

  return context.json({ said })
})

notes.get('/notes/:id/said/:hash', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const content = await saidAs(context.env, found.note.id, context.req.param('hash'))
  if (content === null) return context.json({ error: 'no such version' }, 404)
  return context.json({ content })
})

notes.post('/spaces/:spaceId/rollback', atLeast('write', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const under = body.text('under', PATH_LIMIT) ?? ''
  const at = body.count('at')
  const dry = body.flag('dry') === true
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (at === undefined || at <= 0) return context.json({ error: 'when to go back to' }, 400)

  const folder = under.replace(/^\/+/, '')
  const changed = await versionsAt(context.env, space.id, folder, at)

  const cut = changed.length >= ROLLBACK_AT_ONCE
  const held = cut ? await countVersionsAt(context.env, space.id, folder, at) : changed.length

  if (dry) {
    return context.json({
      notes: changed.length,
      paths: changed.slice(0, SHOWN_PATHS).map((one) => one.path),
      more: changed.length > SHOWN_PATHS,
      partial: cut && held > changed.length,
      left: Math.max(held - changed.length, 0),
    })
  }

  const asking = deviceIn(said((name) => context.req.header(name), 'device'))
  const device = await deviceOf(context)

  let written = 0
  let refused = 0
  for (const one of changed) {
    let note = await noteById(context.env, one.note_id)
    if (!note) continue

    const words = note.hash !== one.hash
    const object = words ? await context.env.NOTES.get(versionKey(one.hash)) : null
    if (words && !object) continue

    if (note.deleted) {
      note = await restoreNote(context.env, note, device)
      if (note.deleted) continue
    }
    if (!object) {
      written += 1
      continue
    }

    const current = await context.env.NOTES.get(noteKey(note.space_id, note.id))
    if (current) await holdVersion(context.env, note, await current.text(), '')

    const saved = await writeWords(context.env, note, await object.text(), note.path, {
      name: asking,
      device,
    })
    if (saved === UNREADABLE) refused += 1
    else if (saved !== null && saved !== MOVED) written += 1
  }

  const left = Math.max(held - written - refused, 0)

  return context.json({ notes: written, refused, partial: left > 0, left })
})

const SHOWN_PATHS = 40

notes.put('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  const { note, space } = found

  const body = await readBody(context)
  const given = body.text('path', PATH_LIMIT)
  const sent = body.text('content', MAX_NOTE_BYTES)
  const baseVersion = body.count('baseVersion')
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (byteLength(sent ?? '') > MAX_NOTE_BYTES) {
    return context.json({ error: TOO_LARGE }, 413)
  }

  const path = given === undefined || given === note.path ? note.path : cleanPath(given)
  if (!path) return context.json({ error: NOT_A_PATH }, 400)

  if (found.only && path !== note.path) {
    return context.json({ error: 'this note was shared with you, not its folder' }, 403)
  }

  const lands = note.name_key ? note.path : path
  const there = await noteAt(context.env, space.id, lands)
  if (there && there.id !== note.id) {
    return context.json({ error: 'a note already lives there', note: presentNote(there) }, 409)
  }

  let content = sent ?? ''
  let base = baseVersion

  if (baseVersion !== undefined && baseVersion !== note.version) {
    if (noteKind({ path, kind: note.kind, epoch: note.epoch }) !== 'plane') {
      return await conflict(context, note.id)
    }
    if (!readsAs('plane', content)) return context.json({ error: NOT_A_CANVAS }, 422)

    const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
    content = mergeCanvasFiles(content, object ? await object.text() : '')
    if (byteLength(content) > MAX_NOTE_BYTES) {
      return context.json({ error: TOO_LARGE }, 413)
    }
    base = note.version
  }

  if (!(await fits(context.env, space.user_id, byteLength(content), note.size))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const placed = !!note.name_key
  const device = await deviceOf(context)
  let written: Awaited<ReturnType<typeof writeWords>>
  try {
    written = await writeWords(context.env, note, content, placed ? note.path : path, {
      name: deviceIn(said((name) => context.req.header(name), 'device')),
      device,
      ...(base === undefined ? {} : { base }),
    })
  } catch (error) {
    const won = await noteAt(context.env, space.id, lands)
    if (!won || won.id === note.id) throw error
    return context.json({ error: 'a note already lives there', note: presentNote(won) }, 409)
  }

  if (written === null) return context.json({ error: ROOM_AWAY }, 503, { 'retry-after': '1' })

  if (written === MOVED) return await conflict(context, note.id)
  if (written === UNREADABLE) return context.json({ error: NOT_A_CANVAS }, 422)

  let saved = written
  if (placed && path !== note.path) {
    await moveByPath(context.env, note.space_id, device, note.id, path)
    saved = (await noteById(context.env, note.id)) ?? saved
  }

  await pokeSpace(context.env, laterOf(context), note.space_id, saved.seq, device)
  return context.json({ note: presentNote(saved) })
})

async function conflict(
  context: Context<{ Bindings: Env; Variables: Variables }>,
  noteId: string,
): Promise<Response> {
  const held = await context.env.DB.prepare('select * from notes where id = ?')
    .bind(noteId)
    .first<Note>()

  const object = held ? await context.env.NOTES.get(noteKey(held.space_id, held.id)) : null

  return context.json(
    {
      error: 'this note changed elsewhere',
      ...(held ? { note: presentNote(held) } : {}),
      content: object ? await object.text() : '',
    },
    409,
  )
}

notes.delete('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  if (found.only) {
    return context.json({ error: 'this note was shared with you, not its folder' }, 403)
  }
  const { note } = found
  const device = await deviceOf(context)

  if (note.name_key) {
    await deleteById(context.env, note.space_id, device, note.id)
    await pokeSpace(context.env, laterOf(context), note.space_id, note.seq, device)
    return context.json({ ok: true })
  }

  if (note.deleted) return context.json({ ok: true })

  const at = now()
  await atNextSeq(
    context.env,
    note.space_id,
    context.env.DB.prepare(
      `update notes set deleted = 1, deleted_at = ?2, seq = ${TAKEN_SEQ}, version = version + 1,
                        updated_at = ?2
        where id = ?3`,
    ).bind(note.space_id, at, note.id),
  )

  return context.json({ ok: true })
})

function noteById(env: Env, id: string): Promise<Note | null> {
  return env.DB.prepare('select * from notes where id = ?').bind(id).first<Note>()
}

export async function restoreNote(env: Env, note: Note, device: string | undefined): Promise<Note> {
  if (note.name_key) {
    await deleteById(env, note.space_id, device, note.id, true)
    const back = await noteById(env, note.id)
    if (back) return back
  }

  const live = await env.DB.prepare('select path from notes where space_id = ? and deleted = 0')
    .bind(note.space_id)
    .all<{ path: string }>()
  const taken = new Set(live.results.map((one) => one.path))
  const path = freePath(note.path, (candidate) => taken.has(candidate))

  const at = now()
  const { seq, changes } = await atNextSeq(
    env,
    note.space_id,
    env.DB.prepare(
      `update notes set deleted = 0, deleted_at = null, path = ?2, seq = ${TAKEN_SEQ},
                        version = version + 1, updated_at = ?3
        where id = ?4 and deleted = 1 and deleted_at is not null`,
    ).bind(note.space_id, path, at, note.id),
  )
  if (!changes) return (await noteById(env, note.id)) ?? note

  return {
    ...note,
    deleted: 0,
    deleted_at: null,
    path,
    seq,
    version: note.version + 1,
    updated_at: at,
  }
}

export const MOVED = 'moved'

export const UNREADABLE = 'unreadable'

const NOT_A_CANVAS = 'this note is a canvas - write a canvas into it'

export interface Writer {
  name: string
  device?: string
  base?: number
}

export async function writeWords(
  env: Env,
  note: Note,
  text: string,
  path: string,
  writer: Writer,
): Promise<Note | typeof MOVED | typeof UNREADABLE | null> {
  if ((note.epoch ?? 0) >= 1) {
    const answer = await ingestInto(env, note, text, writer)
    if (answer && 'refused' in answer && answer.refused === UNREADABLE) return UNREADABLE
    if (!answer || 'refused' in answer) return null
    return 'conflict' in answer ? MOVED : answer.note
  }

  const saved = await saveNote(env, note, text, path, writer.name, {
    ...(writer.device === undefined ? {} : { docBy: writer.device }),
  })
  if (saved) return saved

  const now = await noteById(env, note.id)
  if (now && (now.epoch ?? 0) >= 1 && now.version === note.version) {
    return await writeWords(env, now, text, path, writer)
  }
  return MOVED
}
