/** The connector an LLM talks to, over HTTP rather than a local process.
 *
 *  One token per person, covering every space they have synced. The token is
 *  the only thing that identifies the caller, so it is stored hashed and can be
 *  taken back at any time. */

import { Hono } from 'hono'
import { newId, now, randomToken, sha256 } from './crypto'
import { cleanPath } from './notes'
import type { Env, Variables } from './types'

const PROTOCOL = '2025-06-18'

export interface TokenRow {
  token_hash: string
  user_id: string
  read_only: number
}

/** Tokens are recognisable on sight, so one found in a config file is obvious. */
function mint(): string {
  return `nib_${randomToken()}`
}

export async function issueToken(env: Env, userId: string, readOnly: boolean): Promise<string> {
  const token = mint()

  // One token at a time: a second one nobody remembers issuing is a way in
  // that nobody would think to close.
  await env.DB.prepare('delete from mcp_tokens where user_id = ?').bind(userId).run()
  await env.DB.prepare(
    'insert into mcp_tokens (token_hash, user_id, read_only, created_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(token), userId, readOnly ? 1 : 0, now())
    .run()

  return token
}

async function bearer(env: Env, header: string | undefined): Promise<TokenRow | null> {
  const token = header?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const row = await env.DB.prepare(
    'select token_hash, user_id, read_only from mcp_tokens where token_hash = ?',
  )
    .bind(await sha256(token))
    .first<TokenRow>()

  if (row) {
    await env.DB.prepare('update mcp_tokens set last_used_at = ? where token_hash = ?')
      .bind(now(), row.token_hash)
      .run()
  }

  return row ?? null
}

/** The token management the app calls, behind the ordinary session. */
export const mcpAdmin = new Hono<{ Bindings: Env; Variables: Variables }>()

mcpAdmin.get('/', async (context) => {
  const row = await context.env.DB.prepare(
    'select read_only, created_at, last_used_at from mcp_tokens where user_id = ?',
  )
    .bind(context.get('user').id)
    .first<{ read_only: number; created_at: number; last_used_at: number | null }>()

  return context.json({
    // The secret itself is never returned again; only that one exists.
    exists: !!row,
    readOnly: row ? !!row.read_only : true,
    createdAt: row?.created_at ?? null,
    lastUsedAt: row?.last_used_at ?? null,
  })
})

mcpAdmin.post('/', async (context) => {
  const body = await context.req
    .json<{ readOnly?: boolean }>()
    .catch((): { readOnly?: boolean } => ({}))

  const token = await issueToken(context.env, context.get('user').id, body.readOnly !== false)

  return context.json({ token })
})

mcpAdmin.delete('/', async (context) => {
  await context.env.DB.prepare('delete from mcp_tokens where user_id = ?')
    .bind(context.get('user').id)
    .run()

  return context.json({ ok: true })
})

/* ── The connector itself ─────────────────────────────────────────────── */

interface Rpc {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

const TOOLS = [
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
      properties: { space: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } },
      required: ['space', 'path', 'content'],
    },
  },
]

async function spacesFor(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    'select id, name from spaces where user_id = ? and deleted = 0 order by name',
  )
    .bind(userId)
    .all<{ id: string; name: string }>()

  return results ?? []
}

/** Accepts a name or an id, so an LLM can use whichever it saw last. */
async function findSpace(env: Env, userId: string, wanted: string) {
  const all = await spacesFor(env, userId)
  const needle = wanted.trim().toLowerCase()

  return all.find((space) => space.id === wanted || space.name.toLowerCase() === needle) ?? null
}

async function noteBody(env: Env, spaceId: string, noteId: string): Promise<string> {
  const object = await env.NOTES.get(`spaces/${spaceId}/${noteId}`)
  return object ? object.text() : ''
}

async function call(env: Env, token: TokenRow, name: string, args: Record<string, unknown>) {
  const userId = token.user_id

  if (name === 'list_spaces') {
    const all = await spacesFor(env, userId)
    return all.map((space) => space.name).join('\n') || 'No spaces yet.'
  }

  const space = args.space ? await findSpace(env, userId, String(args.space)) : null
  if (args.space && !space) return `No space called ${String(args.space)}.`

  if (name === 'list_notes') {
    const { results } = await env.DB.prepare(
      'select path from notes where space_id = ? and deleted = 0 order by path',
    )
      .bind(space!.id)
      .all<{ path: string }>()

    return (results ?? []).map((row) => row.path).join('\n') || 'No notes yet.'
  }

  if (name === 'read_note') {
    const path = cleanPath(String(args.path ?? ''))
    if (!path) return 'That is not a note path.'

    const note = await env.DB.prepare(
      'select id from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space!.id, path)
      .first<{ id: string }>()

    if (!note) return `No note at ${path}.`
    return noteBody(env, space!.id, note.id)
  }

  if (name === 'search_notes') {
    const needle = String(args.query ?? '').toLowerCase()
    if (!needle) return 'Give me something to look for.'

    const scope = space ? [space] : await spacesFor(env, userId)
    const found: string[] = []

    for (const one of scope) {
      const { results } = await env.DB.prepare(
        'select id, path from notes where space_id = ? and deleted = 0 order by path',
      )
        .bind(one.id)
        .all<{ id: string; path: string }>()

      for (const row of results ?? []) {
        if (found.length >= 50) break

        const body = await noteBody(env, one.id, row.id)
        const line = body.split('\n').find((text) => text.toLowerCase().includes(needle))
        if (line) found.push(`${one.name}/${row.path}: ${line.trim().slice(0, 200)}`)
      }
    }

    return found.join('\n') || 'Nothing found.'
  }

  if (name === 'write_note') {
    if (token.read_only) return 'This token may only read. Allow writing in Nib’s settings first.'

    const path = cleanPath(String(args.path ?? ''))
    if (!path) return 'That is not a note path.'
    if (!space) return 'Which space?'

    const content = String(args.content ?? '')
    const existing = await env.DB.prepare(
      'select id, version from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, path)
      .first<{ id: string; version: number }>()

    const id = existing?.id ?? newId()
    const seq = await env.DB.prepare(
      `insert into space_cursor (space_id, next) values (?, 2)
       on conflict(space_id) do update set next = next + 1
       returning next - 1 as seq`,
    )
      .bind(space.id)
      .first<{ seq: number }>()

    await env.NOTES.put(`spaces/${space.id}/${id}`, content)

    if (existing) {
      await env.DB.prepare(
        `update notes set version = version + 1, seq = ?, updated_at = ?, size = ?, hash = ?
         where id = ?`,
      )
        .bind(seq?.seq ?? 1, now(), content.length, await sha256(content), id)
        .run()
    } else {
      await env.DB.prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, size, hash)
         values (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
        .bind(id, space.id, path, seq?.seq ?? 1, now(), content.length, await sha256(content))
        .run()
    }

    return `Saved ${path}.`
  }

  return `No tool called ${name}.`
}

export const mcp = new Hono<{ Bindings: Env }>()

/** Streamable HTTP: one endpoint, JSON-RPC in, JSON-RPC out. */
mcp.post('/', async (context) => {
  const token = await bearer(context.env, context.req.header('authorization'))
  if (!token) return context.json({ error: 'sign in first' }, 401)

  const request = await context.req.json<Rpc>().catch(() => null)
  if (!request?.method) return context.json({ error: 'not a request' }, 400)

  const reply = (result: unknown) =>
    context.json({ jsonrpc: '2.0', id: request.id ?? null, result })

  switch (request.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'nib', version: '1.0.0' },
      })

    // Notifications carry no id and expect no answer.
    case 'notifications/initialized':
      return new Response(null, { status: 202 })

    case 'ping':
      return reply({})

    case 'tools/list':
      return reply({ tools: TOOLS })

    case 'tools/call': {
      const name = String(request.params?.name ?? '')
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>

      try {
        const text = await call(context.env, token, name, args)
        return reply({ content: [{ type: 'text', text }] })
      } catch (error) {
        return reply({
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'failed' }],
          isError: true,
        })
      }
    }

    default:
      return context.json({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: -32601, message: `unknown method ${request.method}` },
      })
  }
})
