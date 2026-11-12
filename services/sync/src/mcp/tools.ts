import { clockOf } from '@orden/bases/agent'
import { untrusted } from '@orden/chats/agent'
import { isAccountInbox } from '@orden/bases/inbox'
import { findLinks } from '@orden/markdown'
import type { ItemMeta } from '@orden/sync-core'
import { byteLength } from '../crypto'
import { pokeNow } from '../hub/poke'
import { inboxText } from '../inbox-text'
import {
  addNote,
  cleanPath,
  readablePath,
  MAX_NOTE_BYTES,
  MOVED,
  NoteTaken,
  noteKey,
  UNREADABLE,
  writeWords,
} from '../notes'
import { noteKind, readsAs } from '../rooms/kind'
import { fits } from '../storage'
import { hashOfBytes } from '../sync2/files'
import type { Env, Note } from '../types'
import { dated, zoneOf } from './dated'
import type { TokenRow } from './tokens'
import { PROTECTED, type Shut, shutFor } from '../protected'

const MOST_SPACES = 500
const MOST_NOTES = 1000
const MOST_MATCHES = 50
const MOST_SEARCHED = 300
const LONGEST_QUERY = 1000

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

function lineAt(body: string, at: number): number {
  return body.slice(0, at).split('\n').length - 1
}

export const TOOLS = [
  {
    name: 'list_spaces',
    description: 'List the spaces in this account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_notes',
    description: 'List the notes in a space.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string', description: 'Space name or id.' } },
      required: ['space'],
    },
  },
  {
    name: 'read_note',
    description: 'Read one note.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string', description: 'Path inside the space, such as ideas/plan.md' },
      },
      required: ['space', 'path'],
    },
  },
  {
    name: 'search_notes',
    description: 'Find notes containing some text.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, space: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'list_backlinks',
    description: 'List the notes that link to one note.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string', description: 'Path inside the space, such as ideas/plan.md' },
      },
      required: ['space', 'path'],
    },
  },
  {
    name: 'write_note',
    description:
      'Create or replace a note. Refused while the token is read-only, and in a space that was shared to read.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space', 'path', 'content'],
    },
  },
]

export interface Space {
  id: string
  name: string
  role: 'owner' | 'write' | 'read'
  user_id: string
  shared: boolean
  items: boolean
}

export function spaceSource(space: Space): string | null {
  return space.shared || space.items ? `shared space ${space.name}` : null
}

function noteSource(
  space: Space,
  items: ReadonlySet<string>,
  note: { id: string; path: string },
): string | null {
  if (space.shared) return `shared space ${space.name}`
  return items.has(note.id) ? `shared note ${space.name}/${note.path}` : null
}

export function marked(source: string | null, words: string): string {
  return source === null ? words : untrusted(source, words)
}

async function sharedItems(env: Env, space: Space): Promise<Set<string>> {
  if (!space.items) return new Set()
  const { results } = await env.DB.prepare(
    `select item from space_members where space_id = ?1 and item <> ''
     union select item from guest_members
      where space_id = ?1 and item <> '' and joined_at is not null
     union select item from once_shared where space_id = ?1 and item <> ''`,
  )
    .bind(space.id)
    .all<{ item: string }>()
  return new Set(results.map((row) => row.item))
}

function text(args: Record<string, unknown>, name: string): string | undefined | null {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : null
}

export async function spacesFor(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    `select sp.id, sp.name, sp.user_id,
        case when sp.user_id = ?1 then 'owner' else m.role end as role,
        (sp.user_id <> ?1
          or exists (select 1 from space_members o where o.space_id = sp.id and o.item = '')
          or exists (select 1 from guest_members g where g.space_id = sp.id and g.item = ''
                      and g.joined_at is not null)
          or exists (select 1 from once_shared x where x.space_id = sp.id and x.item = '')) as shared,
        (exists (select 1 from space_members o where o.space_id = sp.id and o.item <> '')
          or exists (select 1 from guest_members g where g.space_id = sp.id and g.item <> ''
                      and g.joined_at is not null)
          or exists (select 1 from once_shared x where x.space_id = sp.id and x.item <> '')) as items
      from spaces sp
      left join space_members m
        on m.space_id = sp.id and m.item = ''
       and m.email = (select email from users where id = ?1)
     where sp.deleted = 0 and (sp.user_id = ?1 or m.role is not null)
     order by sp.name limit ?2`,
  )
    .bind(userId, MOST_SPACES)
    .all<Omit<Space, 'shared' | 'items'> & { shared: number; items: number }>()

  return results.map((row) => ({ ...row, shared: !!row.shared, items: !!row.items }))
}

async function findSpace(env: Env, userId: string, wanted: string): Promise<Space | string | null> {
  const all = await spacesFor(env, userId)
  const byId = all.find((space) => space.id === wanted)
  if (byId) return byId

  const needle = wanted.trim().toLowerCase()
  const named = all.filter((space) => space.name.toLowerCase() === needle)
  const own = named.find((space) => space.role === 'owner')
  if (own || named.length < 2) return own ?? named[0] ?? null

  const ids = named.map((space) => space.id).join(', ')
  return `${named.length} spaces shared with you are called ${wanted}: ${ids}. Name one by its id.`
}

export async function noteBody(env: Env, spaceId: string, noteId: string): Promise<string> {
  const object = await env.NOTES.get(noteKey(spaceId, noteId))
  return object ? object.text() : ''
}

export async function askedSpace(
  env: Env,
  userId: string,
  args: Record<string, unknown>,
): Promise<Space | string> {
  const wanted = text(args, 'space')
  if (wanted === null) return 'The space has to be a name or an id.'
  if (!wanted?.trim()) return 'Which space?'

  return (await findSpace(env, userId, wanted)) ?? `No space called ${wanted}.`
}

async function listNotes(env: Env, space: Space): Promise<string> {
  const { results } = await env.DB.prepare(
    `select path from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_NOTES)
    .all<{ path: string }>()

  if (!results.length) return 'No notes yet.'
  return marked(spaceSource(space), results.map((row) => row.path).join('\n'))
}

async function readNote(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
  shut: Shut,
): Promise<string> {
  const path = readablePath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'
  if (shut(space.id, path)) return PROTECTED(path)

  const note = await env.DB.prepare(
    "select id from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<{ id: string }>()

  if (!note) return `No note at ${path}.`
  const source = noteSource(space, await sharedItems(env, space), { id: note.id, path })
  return marked(source, await noteBody(env, space.id, note.id))
}

async function searchNotes(
  env: Env,
  scope: Space[],
  args: Record<string, unknown>,
  shut: Shut,
): Promise<string> {
  const asked = text(args, 'query')
  if (asked === null) return 'The query has to be text.'

  const needle = (asked ?? '').toLowerCase()
  if (!needle) return 'Give me something to look for.'
  if (needle.length > LONGEST_QUERY) return `A search is at most ${LONGEST_QUERY} characters.`

  const own: string[] = []
  const theirs = new Map<string, string[]>()
  let count = 0
  let read = 0

  for (const one of scope) {
    if (count >= MOST_MATCHES || read >= MOST_SEARCHED) break

    const items = await sharedItems(env, one)
    const { results } = await env.DB.prepare(
      `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
        order by path limit ?`,
    )
      .bind(one.id, MOST_NOTES)
      .all<{ id: string; path: string }>()

    for (const row of results) {
      if (count >= MOST_MATCHES || read >= MOST_SEARCHED) break
      if (shut(one.id, row.path)) continue
      read++

      const body = await noteBody(env, one.id, row.id)
      const line = body.split('\n').find((entry) => entry.toLowerCase().includes(needle))
      if (!line) continue
      count++
      const said = `${one.name}/${row.path}: ${line.trim().slice(0, 200)}`
      const source = noteSource(one, items, row)
      if (source === null) own.push(said)
      else {
        const gathered = theirs.get(source)
        if (gathered) gathered.push(said)
        else theirs.set(source, [said])
      }
    }
  }

  if (!count) return 'Nothing found.'
  const blocks = [...theirs].map(([source, lines]) => untrusted(source, lines.join('\n')))
  return [...own, ...blocks].join('\n')
}

async function listBacklinks(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
  shut: Shut,
): Promise<string> {
  const path = readablePath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const names = new Set<string>()
  const parts = path.replace(MARKDOWN, '').toLowerCase().split('/')
  for (let at = 0; at < parts.length; at++) names.add(parts.slice(at).join('/'))

  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
        order by path limit ?`,
  )
    .bind(space.id, MOST_NOTES)
    .all<{ id: string; path: string }>()

  const found: string[] = []

  for (const row of results) {
    if (found.length >= MOST_MATCHES || row.path === path || shut(space.id, row.path)) continue

    const body = await noteBody(env, space.id, row.id)
    for (const link of findLinks(body)) {
      const said = link.target.replace(MARKDOWN, '').toLowerCase()
      if (said.startsWith('/') ? said.slice(1) !== parts.join('/') : !names.has(said)) continue
      found.push(`${row.path}:${lineAt(body, link.from) + 1}`)
      break
    }
  }

  if (!found.length) return `Nothing links to ${path}.`
  return marked(spaceSource(space), found.join('\n'))
}

async function writeNote(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
  device: string | undefined,
  user: string,
): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const asked = text(args, 'content')
  if (asked === null) return 'The content has to be text.'
  const held = await noteRead(env, space.id, path)
  const put = await putNote(env, space, path, asked ?? '', device)
  if (put === MOVED) return changedWhileWriting(path)
  if (typeof put === 'string') return put
  if (held && held !== MOVED) {
    const { today } = clockOf(new Date(), await zoneOf(env, user))
    await dated(env, space, put.path, held.words, asked ?? '', held.note, today)
  }
  return `Saved ${put.path}.`
}

export function changedWhileWriting(path: string): string {
  return `${path} changed while I was writing it. Read it again first.`
}

const READS = 3

export async function noteRead(
  env: Env,
  spaceId: string,
  path: string,
): Promise<{ note: Note; words: string } | null | typeof MOVED> {
  for (let tries = 0; tries < READS; tries++) {
    const note = await env.DB.prepare(
      "select * from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
    )
      .bind(spaceId, path)
      .first<Note>()
    if (!note) return null
    const object = await env.NOTES.get(noteKey(spaceId, note.id))
    const bytes = object ? await object.arrayBuffer() : new ArrayBuffer(0)
    if ((await hashOfBytes(bytes)) === note.hash) {
      return { note, words: new TextDecoder().decode(bytes) }
    }
  }
  return MOVED
}

export async function putNote(
  env: Env,
  space: Pick<Space, 'id' | 'user_id'>,
  path: string,
  content: string,
  device?: string,
  read?: Note | null,
  meta?: ItemMeta,
): Promise<{ path: string } | string> {
  const size = byteLength(content)
  if (size > MAX_NOTE_BYTES) return 'That note is too large.'

  const existing = await env.DB.prepare(
    "select * from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<Note>()

  if (read !== undefined && (existing?.id !== read?.id || existing?.version !== read?.version)) {
    return MOVED
  }

  const named = noteKind({ path })
  if (!existing && !readsAs(named, content)) return notACanvas(path)

  if (!(await fits(env, space.user_id, size, existing?.size ?? 0))) {
    return 'This account is out of space.'
  }

  if (existing) {
    const saved = await writeWords(env, existing, content, path, {
      name: '',
      ...(device === undefined ? {} : { device }),
      ...(read ? { base: read.version } : {}),
    })
    if (saved === null) return `${path} could not be written just now. Try again.`
    if (saved === MOVED) return read === undefined ? changedWhileWriting(path) : MOVED
    if (saved === UNREADABLE) return notACanvas(path)
    if ((saved.epoch ?? 0) < 1) await pokeNow(env, space.id, saved.seq, device)
    return { path: saved.path }
  }

  try {
    const made = await addNote(env, space.id, path, content, '', device, meta)
    await pokeNow(env, space.id, made.seq, device)
    return { path: made.path }
  } catch (error) {
    const arrived = await env.DB.prepare(
      "select 1 as one from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
    )
      .bind(space.id, path)
      .first()
    if (arrived) return read === undefined ? changedWhileWriting(path) : MOVED
    if (!(error instanceof NoteTaken)) throw error
    return `${path} is another spelling of a note that is already there. Read it first.`
  }
}

function notACanvas(path: string): string {
  return `${path} is a canvas. Write JSON Canvas into it, or leave it as it is.`
}

export async function callTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const userId = token.user_id

  switch (name) {
    case 'list_spaces': {
      const all = await spacesFor(env, userId)
      if (!all.length) return 'No spaces yet.'
      const own = all.filter((space) => space.role === 'owner').map((space) => space.name)
      const theirs = all.filter((space) => space.role !== 'owner').map((space) => space.name)
      const block = theirs.length ? [untrusted('spaces shared with you', theirs.join('\n'))] : []
      return [...own, ...block].join('\n')
    }

    case 'list_notes': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : listNotes(env, space)
    }

    case 'read_note': {
      const space = await askedSpace(env, userId, args)
      if (typeof space === 'string') return space
      if (isAccountInbox(text(args, 'path') ?? '')) return inboxText(env, userId)
      return readNote(env, space, args, await shutFor(env, userId))
    }

    case 'search_notes': {
      if (args.space !== undefined && args.space !== null) {
        const space = await askedSpace(env, userId, args)
        return typeof space === 'string'
          ? space
          : searchNotes(env, [space], args, await shutFor(env, userId))
      }
      return searchNotes(env, await spacesFor(env, userId), args, await shutFor(env, userId))
    }

    case 'list_backlinks': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string'
        ? space
        : listBacklinks(env, space, args, await shutFor(env, userId))
    }

    case 'write_note': {
      if (token.read_only)
        return 'This token may only read. Allow writing in Orden’s settings first.'

      const space = await askedSpace(env, userId, args)
      if (typeof space === 'string') return space
      if (space.role === 'read') return `${space.name} was shared with you to read, not to write.`
      const path = cleanPath(text(args, 'path') ?? '')
      if (path && (await shutFor(env, userId))(space.id, path)) return PROTECTED(path)

      return writeNote(env, space, args, token.device, userId)
    }

    default:
      return `No tool called ${name}.`
  }
}
