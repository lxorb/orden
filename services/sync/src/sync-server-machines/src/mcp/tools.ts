import { untrusted } from '@orden/chats/agent'
import { findLinks } from '@orden/markdown'
import { foldName } from '@orden/markdown/links'
import type { ItemMeta } from '@orden/sync-core'
import {
  byteLength,
  pokeNow,
  addNote,
  cleanPath,
  readablePath,
  MAX_NOTE_BYTES,
  MOVED,
  NoteTaken,
  noteKey,
  UNREADABLE,
  writeWords,
  noteKind,
  readsAs,
  fits,
  spacesFor,
  PROTECTED,
  shutFor,
  type Env,
  type Note,
  type ListedSpace as Space,
  type Shut,
} from '../../../sync-server/src/api'
export { type Space, spacesFor }
import type { TokenRow } from './tokens'
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

async function findSpace(env: Env, userId: string, wanted: string): Promise<Space | string | null> {
  const all = await spacesFor(env, userId)
  const byId = all.find((space) => space.id === wanted)
  if (byId) return byId

  const needle = wanted.trim().toLowerCase()
  const named = all.filter((space) => space.name.toLowerCase() === needle)
  const own = named.filter((space) => space.role === 'owner')
  if (own.length === 1 || named.length < 2) return own[0] ?? named[0] ?? null

  const asked = own.length ? own : named
  const ids = asked.map((space) => space.id).join(', ')
  const whose = own.length ? 'of yours' : 'shared with you'
  return `${asked.length} spaces ${whose} are called ${wanted}: ${ids}. Name one by its id.`
}

function spaceLines(all: readonly Space[]): string[] {
  const count = new Map<string, number>()
  for (const space of all) {
    const name = space.name.toLowerCase()
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  return all.map((space) =>
    (count.get(space.name.toLowerCase()) ?? 0) > 1 ? `${space.name} (id ${space.id})` : space.name,
  )
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
    .bind(space.id, MOST_NOTES + 1)
    .all<{ path: string }>()

  if (!results.length) return 'No notes yet.'
  const listed = marked(
    spaceSource(space),
    results
      .slice(0, MOST_NOTES)
      .map((row) => row.path)
      .join('\n'),
  )
  return results.length > MOST_NOTES ? `${listed}\n${stoppedAt(MOST_NOTES)}` : listed
}

function stoppedAt(count: number): string {
  return `I stopped after ${count} notes, so the others are not listed.`
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
  let unread = false

  for (const one of scope) {
    if (count >= MOST_MATCHES) break

    const items = await sharedItems(env, one)
    const { results } = await env.DB.prepare(
      `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
        order by path limit ?`,
    )
      .bind(one.id, MOST_NOTES + 1)
      .all<{ id: string; path: string }>()
    if (results.length > MOST_NOTES) unread = true

    for (const row of results.slice(0, MOST_NOTES)) {
      if (count >= MOST_MATCHES) break
      if (shut(one.id, row.path)) continue
      if (read >= MOST_SEARCHED) {
        unread = true
        break
      }
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

  const stopped = unread
    ? [`I stopped after reading ${read} notes, so the others were not searched.`]
    : []
  const most = count >= MOST_MATCHES ? [`These are the first ${MOST_MATCHES} matches.`] : []
  if (!count) return ['Nothing found.', ...stopped].join(' ')
  const blocks = [...theirs].map(([source, lines]) => untrusted(source, lines.join('\n')))
  return [...own, ...blocks, ...most, ...stopped].join('\n')
}

function comparable(path: string): string {
  return foldName(path.replace(/\\/g, '/').replace(MARKDOWN, ''))
}

function climbed(start: string[], written: string): string[] {
  const parts = [...start]
  for (const part of written.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts
}

function nearestNamed(held: readonly string[], name: string, from: string): string | null {
  if (!name) return null
  const here = comparable(from).split('/').slice(0, -1).join('/')
  const folder = (path: string) => path.split('/').slice(0, -1).join('/')
  const found = held.filter((path) => path === name || path.endsWith(`/${name}`))
  found.sort(
    (one, other) =>
      Number(folder(one) !== here) - Number(folder(other) !== here) ||
      one.split('/').length - other.split('/').length ||
      (one < other ? -1 : 1),
  )
  return found[0] ?? null
}

function wikilinkTarget(from: string, target: string, held: readonly string[]): string | null {
  const said = comparable(target.trim())
  if (!said.startsWith('/')) return nearestNamed(held, said, from)
  const path = said.slice(1)
  return held.includes(path) ? path : null
}

function markdownTarget(from: string, target: string, held: readonly string[]): string | null {
  const written = target.replace(/\\/g, '/')
  const anchored = written.startsWith('/')
  const folder = foldName(from).split('/').slice(0, -1)
  const parts = comparable(climbed(anchored ? [] : folder, foldName(written)).join('/'))
  if (!parts) return null
  if (held.includes(parts)) return parts
  if (anchored) return null
  if (/^\.\.?\//.test(written)) return nearestNamed(held, parts, from)
  const top = comparable(climbed([], foldName(written)).join('/'))
  if (held.includes(top)) return top
  return nearestNamed(held, parts, from) ?? nearestNamed(held, top, from)
}

async function listBacklinks(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
  shut: Shut,
): Promise<string> {
  const path = readablePath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
        order by path limit ?`,
  )
    .bind(space.id, MOST_NOTES + 1)
    .all<{ id: string; path: string }>()
  const stopped = results.length > MOST_NOTES ? [stoppedAt(MOST_NOTES)] : []
  results.splice(MOST_NOTES)

  const wanted = comparable(path)
  const held = results.map((row) => comparable(row.path))
  const found: string[] = []

  for (const row of results) {
    if (found.length >= MOST_MATCHES || row.path === path || shut(space.id, row.path)) continue

    const body = await noteBody(env, space.id, row.id)
    for (const link of findLinks(body)) {
      const reached =
        link.kind === 'markdown'
          ? markdownTarget(row.path, link.target, held)
          : wikilinkTarget(row.path, link.target, held)
      if (reached !== wanted) continue
      found.push(`${row.path}:${lineAt(body, link.from) + 1}`)
      break
    }
  }

  if (!found.length) return [`Nothing links to ${path}.`, ...stopped].join(' ')
  return [marked(spaceSource(space), found.join('\n')), ...stopped].join('\n')
}

async function writeNote(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
  device: string | undefined,
): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const asked = text(args, 'content')
  if (asked === null) return 'The content has to be text.'
  const put = await putNote(env, space, path, asked ?? '', device)
  if (put === MOVED) return changedWhileWriting(path)
  if (typeof put === 'string') return put
  return `Saved ${put.path}.`
}

function changedWhileWriting(path: string): string {
  return `${path} changed while I was writing it. Read it again first.`
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
      const lines = spaceLines(all)
      const own = lines.filter((_, at) => all[at]?.role === 'owner')
      const theirs = lines.filter((_, at) => all[at]?.role !== 'owner')
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

      return writeNote(env, space, args, token.device)
    }

    default:
      return `No tool called ${name}.`
  }
}
