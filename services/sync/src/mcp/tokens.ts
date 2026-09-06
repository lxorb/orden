/** The two ways a connector call proves who it is, and the pane that shows
 *  them: a token the person copied out of the settings, or a grant an LLM
 *  client got by signing them in through OAuth. Both live hashed, so a leaked
 *  database cannot be used to read anyone's notes. */

import { Hono } from 'hono'
import { now, randomToken, sha256 } from '../crypto'
import { grantForToken } from '../oauth'
import type { Env, Variables } from '../types'

export interface TokenRow {
  token_hash: string
  user_id: string
  read_only: number
}

/** Tokens are recognisable on sight, so one found in a config file is obvious. */
function mint(): string {
  return `nib_${randomToken()}`
}

async function issueToken(env: Env, userId: string, readOnly: boolean): Promise<string> {
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

/** The caller, by the token it sent: one a client got by signing the person
 *  in, or one the person copied out of the settings. */
export async function bearer(env: Env, header: string | undefined): Promise<TokenRow | null> {
  const token = header?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const grant = await grantForToken(env, token)
  if (grant) return { token_hash: '', ...grant }

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

/** What the settings show, behind the ordinary session: the clients that
 *  signed in through OAuth, and the pasted token if there is one. */
export const mcpAdmin = new Hono<{ Bindings: Env; Variables: Variables }>()

mcpAdmin.get('/token', async (context) => {
  const userId = context.get('user').id

  const row = await context.env.DB.prepare(
    'select read_only, created_at, last_used_at from mcp_tokens where user_id = ?',
  )
    .bind(userId)
    .first<{ read_only: number; created_at: number; last_used_at: number | null }>()

  const { results } = await context.env.DB.prepare(
    `select id, client_name, read_only, created_at, last_used_at from oauth_grants
      where user_id = ? order by created_at desc limit 200`,
  )
    .bind(userId)
    .all<{
      id: string
      client_name: string
      read_only: number
      created_at: number
      last_used_at: number | null
    }>()

  return context.json({
    // The secret itself is never returned again; only that one exists.
    exists: !!row,
    readOnly: row ? !!row.read_only : true,
    createdAt: row?.created_at ?? null,
    lastUsedAt: row?.last_used_at ?? null,
    clients: results.map((grant) => ({
      id: grant.id,
      name: grant.client_name,
      readOnly: !!grant.read_only,
      createdAt: grant.created_at,
      lastUsedAt: grant.last_used_at,
    })),
  })
})

mcpAdmin.post('/token', async (context) => {
  const body = await context.req.json<unknown>().catch(() => null)
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return context.json({ error: 'send an object' }, 400)
  }

  // Read-only unless writing is asked for in as many words, so a request that
  // says nothing cannot hand out more than the person meant.
  const asked = (body as { readOnly?: unknown } | null)?.readOnly
  if (asked !== undefined && typeof asked !== 'boolean') {
    return context.json({ error: 'readOnly must be true or false' }, 400)
  }

  const token = await issueToken(context.env, context.get('user').id, asked !== false)
  return context.json({ token })
})

mcpAdmin.delete('/token', async (context) => {
  await context.env.DB.prepare('delete from mcp_tokens where user_id = ?')
    .bind(context.get('user').id)
    .run()

  return context.json({ ok: true })
})

/** Disconnects one client. Its tokens stop working at once; it has to sign
 *  the person in again to come back. */
mcpAdmin.delete('/clients/:id', async (context) => {
  await context.env.DB.prepare('delete from oauth_grants where id = ? and user_id = ?')
    .bind(context.req.param('id'), context.get('user').id)
    .run()

  return context.json({ ok: true })
})
