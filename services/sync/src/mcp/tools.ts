/** What the connector can actually do, and the words it answers with.
 *
 *  Every tool answers in prose, because prose is what the model reads: a space
 *  it cannot find, an argument it left out and a token that may not write all
 *  come back as a sentence rather than as an error. Nothing here trusts an
 *  argument's type - a model sends what it likes - so each is checked before
 *  it reaches a query. */

import { untrusted } from '@nib/chats/agent'
import { findLinks } from '@nib/markdown'
import { byteLength } from '../crypto'
import {
  addNote,
  cleanPath,
  MAX_NOTE_BYTES,
  MOVED,
  NoteTaken,
  noteKey,
  UNREADABLE,
  writeWords,
} from '../notes'
import { fits } from '../storage'
import type { Env, Note } from '../types'
import type { TokenRow } from './tokens'

/** Enough that an account's notes are all reachable, small enough that one
 *  call cannot walk an unbounded amount of storage. */
const MOST_SPACES = 500
const MOST_NOTES = 1000
const MOST_MATCHES = 50
/** How many notes a search reads the body of. A match is usually near the
 *  front of an account; past this the answer says it stopped looking. */
const MOST_SEARCHED = 300

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** Which line an offset falls on, counting from zero. */
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

/** One space the caller can reach. Exported because the glasses' own two tools
 *  reach the same spaces through the same query; see ask/notes.ts. */
export interface Space {
  id: string
  name: string
  /** What the account may do here. A space somebody shared read-only is listed,
   *  read and searched like any other; writing into it is refused. */
  role: 'owner' | 'write' | 'read'
  /** Whose storage a note written here lands in, which is whose quota it has
   *  to fit inside. */
  user_id: string
  /** Whether anybody besides the account may write here: the space is somebody
   *  else's, or its owner let somebody else in to the whole of it. */
  shared: boolean
  /** Whether a file of it was handed to somebody on its own. */
  items: boolean
}

/** Where words of a space came from, for the untrusted mark (docs/agent-native.md
 *  9.6): null where only the account can have written them. Asked of the space as a
 *  whole, so one file shared on its own marks every answer about the space, which is
 *  the desktop's rule too (`reachedByOthersIn`). */
export function spaceSource(space: Space): string | null {
  return space.shared || space.items ? `shared space ${space.name}` : null
}

/** Where one note's words came from: its space where anybody else is in that, else
 *  the note where it was shared on its own. */
function noteSource(
  space: Space,
  items: ReadonlySet<string>,
  note: { id: string; path: string },
): string | null {
  if (space.shared) return `shared space ${space.name}`
  return items.has(note.id) ? `shared note ${space.name}/${note.path}` : null
}

/** The words, inside the mark where somebody else may have written them. */
export function marked(source: string | null, words: string): string {
  return source === null ? words : untrusted(source, words)
}

/** The files of a space somebody holds on their own, by note id. The same rows the
 *  listing marks (`itemsSharedIn`): an invitation counts, a guest once joined. And
 *  any somebody once held and has handed back (`once_shared`). */
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

/** An argument the model was asked to send as text. Undefined when it is
 *  missing; null when it is there and is something else, which is a different
 *  thing to say back. */
function text(args: Record<string, unknown>, name: string): string | undefined | null {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : null
}

/** Every space the account can reach: its own, and the ones somebody shared
 *  with it. The membership is joined on the address, which is how it is joined
 *  everywhere else; see spaces/space.ts.
 *
 *  Spaces, and not one file of somebody else's space: `item = ''` is the same
 *  condition every space route holds to. Somebody handed one note is not somebody
 *  who may be told what else is in the drawer, and a connector that listed the
 *  space would hand a model the lot. */
export async function spacesFor(env: Env, userId: string): Promise<Space[]> {
  // Who else is in a space is asked the way the listing asks it (`sharedAmong`,
  // `itemsSharedIn`), so the mark and the rail never disagree. And who else could
  // once write in it (`once_shared`): somebody who left took their row, not their
  // words.
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

/** Accepts a name or an id, so an LLM can use whichever it saw last. Only the
 *  spaces the caller can reach are ever looked at, so an id belonging to
 *  somebody who shared nothing with them is simply not found.
 *
 *  A name is not an id, and two spaces can share one. Being invited is enough to
 *  have a space in the list, so anybody who knows an address can put a space
 *  called Notes beside that person's own Notes - and the first of two equal names
 *  was whichever the database handed back first, which made "write this into
 *  Notes" a way to write it into a stranger's space. So the account's own space
 *  wins its own name, and two spaces nobody here owns are named back by id rather
 *  than chosen between. */
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

/** The space an argument names, or the sentence to answer with instead. */
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

async function readNote(env: Env, space: Space, args: Record<string, unknown>): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

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
): Promise<string> {
  const asked = text(args, 'query')
  if (asked === null) return 'The query has to be text.'

  const needle = (asked ?? '').toLowerCase()
  if (!needle) return 'Give me something to look for.'

  // Lines only the account can have written first, then each source's in one mark.
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
      read++

      const body = await noteBody(env, one.id, row.id)
      const line = body.split('\n').find((entry) => entry.toLowerCase().includes(needle))
      if (!line) continue
      count++
      const said = `${one.name}/${row.path}: ${line.trim().slice(0, 200)}`
      const source = noteSource(one, items, row)
      if (source === null) own.push(said)
      else theirs.set(source, [...(theirs.get(source) ?? []), said])
    }
  }

  if (!count) return 'Nothing found.'
  const blocks = [...theirs].map(([source, lines]) => untrusted(source, lines.join('\n')))
  return [...own, ...blocks].join('\n')
}

/** Which notes link to one note, and the line each says it on.
 *
 *  A link may name a note by its file name or by any tail of its path, so the
 *  names the note answers to are worked out once and every link in the space is
 *  compared against them. Nothing here resolves a name the way the editor does -
 *  which of two notes of one name is meant depends on where the link was written,
 *  and a connector answering "these mention it" is honest and cheap. */
async function listBacklinks(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
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
    if (found.length >= MOST_MATCHES || row.path === path) continue

    const body = await noteBody(env, space.id, row.id)
    for (const link of findLinks(body)) {
      const said = link.target.replace(MARKDOWN, '').toLowerCase()
      // A leading slash is a path from the top of the space, the whole path alone.
      if (said.startsWith('/') ? said.slice(1) !== parts.join('/') : !names.has(said)) continue
      found.push(`${row.path}:${lineAt(body, link.from) + 1}`)
      break
    }
  }

  if (!found.length) return `Nothing links to ${path}.`
  return marked(spaceSource(space), found.join('\n'))
}

/** Writes through the same two limits the sync API applies: a note is at most
 *  so large, and an account holds at most so much. A connector that skipped
 *  them would be the way around the quota. */
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
  return (await putNote(env, space, path, asked ?? '', device)) ?? `Saved ${path}.`
}

/** A note's words written, made where there is none: null when it was, else the
 *  sentence to answer with. The to-dos' tools write through here too (tasks.ts). */
export async function putNote(
  env: Env,
  space: Pick<Space, 'id' | 'user_id'>,
  path: string,
  content: string,
  device?: string,
): Promise<string | null> {
  const size = byteLength(content)
  if (size > MAX_NOTE_BYTES) return 'That note is too large.'

  const existing = await env.DB.prepare(
    "select * from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<Note>()

  // Against whoever owns the space rather than whoever is writing: the bytes
  // land in their storage, so it is their quota the note has to fit inside.
  if (!(await fits(env, space.user_id, size, existing?.size ?? 0))) {
    return 'This account is out of space.'
  }

  // The same two writes the sync API makes, so a note a model wrote is a note
  // like any other: the same version, the same cursor, the same conflict rule.
  // Which includes losing to somebody who saved while this was being written:
  // said plainly, because a model that is told so can read the note again.
  //
  // A note with a document is written by its room, which takes the text in as the
  // operations it differs by (docs/sync-v2.md section 5.3); see `writeWords`.
  if (existing) {
    const saved = await writeWords(env, existing, content, path, {
      name: '',
      ...(device === undefined ? {} : { device }),
    })
    if (saved === null) return `${path} could not be written just now. Try again.`
    if (saved === MOVED) return `${path} changed while I was writing it. Read it again first.`
    if (saved === UNREADABLE) {
      return `${path} is a canvas. Write JSON Canvas into it, or leave it as it is.`
    }
  } else {
    try {
      await addNote(env, space.id, path, content, '', device)
    } catch (error) {
      // A space whose tree is rows holds one name per folder as Windows and a Mac
      // compare names, so another spelling of a note that is there is that note.
      if (!(error instanceof NoteTaken)) throw error
      return `${path} is another spelling of a note that is already there. Read it first.`
    }
  }

  return null
}

/** Runs one tool for one caller. Everything reachable is reached through the
 *  token's own account: there is no argument that names a user. */
export async function callTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const userId = token.user_id

  switch (name) {
    case 'list_spaces': {
      // A space somebody else owns was named by them.
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
      return typeof space === 'string' ? space : readNote(env, space, args)
    }

    case 'search_notes': {
      // A search may name a space or leave it out, which searches the account.
      if (args.space !== undefined && args.space !== null) {
        const space = await askedSpace(env, userId, args)
        return typeof space === 'string' ? space : searchNotes(env, [space], args)
      }
      return searchNotes(env, await spacesFor(env, userId), args)
    }

    case 'list_backlinks': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : listBacklinks(env, space, args)
    }

    case 'write_note': {
      if (token.read_only)
        return 'This token may only read. Allow writing in Orden’s settings first.'

      const space = await askedSpace(env, userId, args)
      if (typeof space === 'string') return space
      if (space.role === 'read') return `${space.name} was shared with you to read, not to write.`

      return writeNote(env, space, args, token.device)
    }

    default:
      return `No tool called ${name}.`
  }
}
