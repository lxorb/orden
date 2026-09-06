/** What the connector can actually do, and the words it answers with.
 *
 *  Every tool answers in prose, because prose is what the model reads: a space
 *  it cannot find, an argument it left out and a token that may not write all
 *  come back as a sentence rather than as an error. Nothing here trusts an
 *  argument's type - a model sends what it likes - so each is checked before
 *  it reaches a query. */

import { byteLength, newId, now, sha256 } from '../crypto'
import { cleanPath, MAX_NOTE_BYTES, nextSeq, noteKey } from '../notes'
import { fits } from '../storage'
import type { Env } from '../types'
import type { TokenRow } from './tokens'

/** Enough that an account's notes are all reachable, small enough that one
 *  call cannot walk an unbounded amount of storage. */
const MOST_SPACES = 500
const MOST_NOTES = 1000
const MOST_MATCHES = 50
/** How many notes a search reads the body of. A match is usually near the
 *  front of an account; past this the answer says it stopped looking. */
const MOST_SEARCHED = 300

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
    name: 'write_note',
    description: 'Create or replace a note. Refused while the token is read-only.',
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

interface Space {
  id: string
  name: string
}

/** An argument the model was asked to send as text. Undefined when it is
 *  missing; null when it is there and is something else, which is a different
 *  thing to say back. */
function text(args: Record<string, unknown>, name: string): string | undefined | null {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : null
}

async function spacesFor(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    'select id, name from spaces where user_id = ? and deleted = 0 order by name limit ?',
  )
    .bind(userId, MOST_SPACES)
    .all<Space>()

  return results
}

/** Accepts a name or an id, so an LLM can use whichever it saw last. Only the
 *  caller's own spaces are ever looked at, so an id from another account is
 *  simply not found. */
async function findSpace(env: Env, userId: string, wanted: string): Promise<Space | null> {
  const all = await spacesFor(env, userId)
  const needle = wanted.trim().toLowerCase()

  return all.find((space) => space.id === wanted || space.name.toLowerCase() === needle) ?? null
}

async function noteBody(env: Env, spaceId: string, noteId: string): Promise<string> {
  const object = await env.NOTES.get(noteKey(spaceId, noteId))
  return object ? object.text() : ''
}

/** The space an argument names, or the sentence to answer with instead. */
async function askedSpace(
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
    'select path from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_NOTES)
    .all<{ path: string }>()

  return results.map((row) => row.path).join('\n') || 'No notes yet.'
}

async function readNote(env: Env, space: Space, args: Record<string, unknown>): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const note = await env.DB.prepare(
    'select id from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<{ id: string }>()

  if (!note) return `No note at ${path}.`
  return noteBody(env, space.id, note.id)
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

  const found: string[] = []
  let read = 0

  for (const one of scope) {
    if (found.length >= MOST_MATCHES || read >= MOST_SEARCHED) break

    const { results } = await env.DB.prepare(
      'select id, path from notes where space_id = ? and deleted = 0 order by path limit ?',
    )
      .bind(one.id, MOST_NOTES)
      .all<{ id: string; path: string }>()

    for (const row of results) {
      if (found.length >= MOST_MATCHES || read >= MOST_SEARCHED) break
      read++

      const body = await noteBody(env, one.id, row.id)
      const line = body.split('\n').find((entry) => entry.toLowerCase().includes(needle))
      if (line) found.push(`${one.name}/${row.path}: ${line.trim().slice(0, 200)}`)
    }
  }

  return found.join('\n') || 'Nothing found.'
}

/** Writes through the same two limits the sync API applies: a note is at most
 *  so large, and an account holds at most so much. A connector that skipped
 *  them would be the way around the quota. */
async function writeNote(
  env: Env,
  userId: string,
  space: Space,
  args: Record<string, unknown>,
): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const asked = text(args, 'content')
  if (asked === null) return 'The content has to be text.'
  const content = asked ?? ''
  const size = byteLength(content)
  if (size > MAX_NOTE_BYTES) return 'That note is too large.'

  const existing = await env.DB.prepare(
    'select id, size from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<{ id: string; size: number }>()

  if (!(await fits(env, userId, size, existing?.size ?? 0))) {
    return 'This account is out of space.'
  }

  const id = existing?.id ?? newId()
  const seq = await nextSeq(env, space.id)
  const hash = await sha256(content)

  await env.NOTES.put(noteKey(space.id, id), content)

  if (existing) {
    await env.DB.prepare(
      `update notes set version = version + 1, seq = ?, updated_at = ?, size = ?, hash = ?
       where id = ?`,
    )
      .bind(seq, now(), size, hash, id)
      .run()
  } else {
    await env.DB.prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, size, hash)
       values (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(id, space.id, path, seq, now(), size, hash)
      .run()
  }

  return `Saved ${path}.`
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
      const all = await spacesFor(env, userId)
      return all.map((space) => space.name).join('\n') || 'No spaces yet.'
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

    case 'write_note': {
      if (token.read_only) return 'This token may only read. Allow writing in Nib’s settings first.'

      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : writeNote(env, userId, space, args)
    }

    default:
      return `No tool called ${name}.`
  }
}
