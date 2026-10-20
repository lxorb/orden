/** The two ways a connector call proves who it is, and the pane that shows
 *  them: a token the person copied out of the settings, or a grant an LLM
 *  client got by signing them in through OAuth. Both live hashed, so a leaked
 *  database cannot be used to read anyone's notes. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { tokenIn } from '../auth'
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

/** A token works only while the session it was handed out through is signed in, so
 *  ending that session ends the token (#461). A row from before tokens named a session
 *  has none, and keeps working. Written once, so every reader asks the same question. */
function liveToken(at: string): string {
  return `(session_hash is null or exists (select 1 from sessions s
            where s.token_hash = mcp_tokens.session_hash and s.expires_at > ${at}))`
}

async function issueToken(
  env: Env,
  userId: string,
  readOnly: boolean,
  sessionHash: string,
): Promise<string> {
  const token = mint()

  // One token at a time: a second one nobody remembers issuing is a way in
  // that nobody would think to close.
  await env.DB.prepare('delete from mcp_tokens where user_id = ?').bind(userId).run()
  await env.DB.prepare(
    `insert into mcp_tokens (token_hash, user_id, read_only, created_at, session_hash)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), userId, readOnly ? 1 : 0, now(), sessionHash)
    .run()

  return token
}

/** The caller, by the token it sent: one a client got by signing the person
 *  in, or one the person copied out of the settings. */
export async function bearer(env: Env, header: string | undefined): Promise<TokenRow | null> {
  // Read the same way a session's header is, so the two cannot drift: the whole
  // of the header was being taken as the token when it named no scheme at all.
  const token = tokenIn(header)
  if (!token) return null

  const grant = await grantForToken(env, token)
  if (grant) return { token_hash: '', ...grant }

  const row = await env.DB.prepare(
    `select token_hash, user_id, read_only from mcp_tokens
      where token_hash = ?1 and ${liveToken('?2')}`,
  )
    .bind(await sha256(token), now())
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
    `select read_only, created_at, last_used_at from mcp_tokens
      where user_id = ?1 and ${liveToken('?2')}`,
  )
    .bind(userId, now())
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
  // A body that says nothing is a body: asking for a token without one means a
  // read-only token, so `undefined` - no body at all - is let through, while a body
  // that parsed to a list or a number is a client's mistake. See objectBody.
  const body = await objectBody(context)
  if (body === null) return context.json({ error: NOT_AN_OBJECT }, 400)

  // Read-only unless writing is asked for in as many words, so a request that
  // says nothing cannot hand out more than the person meant.
  const asked = body?.readOnly
  if (asked !== undefined && typeof asked !== 'boolean') {
    return context.json({ error: 'readOnly must be true or false' }, 400)
  }

  // The session asking: the token lives only as long as it does; see liveToken.
  const session = await sha256(tokenIn(context.req.header('authorization')) ?? '')
  const token = await issueToken(context.env, context.get('user').id, asked !== false, session)
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
