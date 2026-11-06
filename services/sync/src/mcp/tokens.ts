import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { tokenIn } from '../auth'
import { now, randomToken, sha256 } from '../crypto'
import { programDevice } from '../sync2/device'
import { grantForToken } from '../oauth'
import type { Env, Variables } from '../types'

export interface TokenRow {
  token_hash: string
  user_id: string
  read_only: number
  device?: string
}

function mint(): string {
  return `nib_${randomToken()}`
}

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

  await env.DB.prepare('delete from mcp_tokens where user_id = ?').bind(userId).run()
  await env.DB.prepare(
    `insert into mcp_tokens (token_hash, user_id, read_only, created_at, session_hash)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), userId, readOnly ? 1 : 0, now(), sessionHash)
    .run()

  return token
}

export async function bearer(env: Env, header: string | undefined): Promise<TokenRow | null> {
  const token = tokenIn(header)
  if (!token) return null

  const device = await programDevice(token)
  const grant = await grantForToken(env, token)
  if (grant) return { token_hash: '', ...grant, device }

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

  return row ? { ...row, device } : null
}

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
  const body = await objectBody(context)
  if (body === null) return context.json({ error: NOT_AN_OBJECT }, 400)

  const asked = body?.readOnly
  if (asked !== undefined && typeof asked !== 'boolean') {
    return context.json({ error: 'readOnly must be true or false' }, 400)
  }

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

mcpAdmin.delete('/clients/:id', async (context) => {
  await context.env.DB.prepare('delete from oauth_grants where id = ? and user_id = ?')
    .bind(context.req.param('id'), context.get('user').id)
    .run()

  return context.json({ ok: true })
})
