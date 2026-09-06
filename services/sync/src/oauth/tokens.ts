/** The token endpoint, and the grant a token belongs to.
 *
 *  A code is good once, however the attempt goes, and only to the client it was
 *  issued to and only with the verifier whose digest it carries. Access tokens
 *  are short-lived and refresh tokens roll over; both live only as hashes, so a
 *  leaked database is not a set of keys. */

import { type Context, Hono } from 'hono'
import { newId, now, randomToken, sha256 } from '../crypto'
import type { Env } from '../types'
import { clientFor } from './clients'
import { failure, GRANTS, resourceMatches, resourceUrl, SCOPES, textFields } from './protocol'

/** Long enough that a client is not forever refreshing; short enough that a
 *  token found somewhere is soon worthless. Clients refresh without asking. */
const ACCESS_TTL = 24 * 60 * 60 * 1000

export const tokens = new Hono<{ Bindings: Env }>()

/** Token requests come form-encoded, as RFC 6749 says; JSON is taken too,
 *  because some clients send it anyway. */
async function tokenBody(
  context: Context<{ Bindings: Env }>,
): Promise<Record<string, string | undefined>> {
  const type = context.req.header('content-type') ?? ''
  const raw: unknown = type.includes('json')
    ? await context.req.json<unknown>().catch(() => ({}))
    : await context.req.parseBody().catch(() => ({}))

  const object = !!raw && typeof raw === 'object' && !Array.isArray(raw)
  return textFields(object ? (raw as Record<string, unknown>) : {})
}

/** The client's id and, if it has one, its secret: in the body or, for
 *  `client_secret_basic`, in the Authorization header. */
function credentials(
  header: string | undefined,
  body: Record<string, string | undefined>,
): { id: string; secret: string } {
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6).trim())
      const colon = decoded.indexOf(':')
      if (colon > 0) {
        return {
          id: decodeURIComponent(decoded.slice(0, colon)),
          secret: decodeURIComponent(decoded.slice(colon + 1)),
        }
      }
    } catch {
      // Fall through to the body.
    }
  }
  return { id: body.client_id ?? '', secret: body.client_secret ?? '' }
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function verifierMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest) === challenge
}

interface Grant {
  id: string
  client_id: string
  read_only: number
}

/** Fresh tokens for a grant, new or refreshed. The refresh token before this
 *  one stays good until the new one has been used: a client that never got
 *  the reply can try again instead of being locked out. */
async function issue(env: Env, grant: Grant, replacing?: { refresh_hash: string }) {
  const access = `nib_${randomToken()}`
  const refresh = `nibr_${randomToken()}`
  const hashes = {
    access: await sha256(access),
    refresh: await sha256(refresh),
    expiresAt: now() + ACCESS_TTL,
  }

  if (replacing) {
    await env.DB.prepare(
      `update oauth_grants
          set access_hash = ?, access_expires_at = ?, refresh_hash = ?, previous_refresh_hash = ?
        where id = ?`,
    )
      .bind(hashes.access, hashes.expiresAt, hashes.refresh, replacing.refresh_hash, grant.id)
      .run()
  }

  const reply = {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL / 1000),
    refresh_token: refresh,
    scope: grant.read_only ? 'notes:read' : SCOPES.join(' '),
  }

  return { reply, hashes }
}

tokens.post('/token', async (context) => {
  const body = await tokenBody(context)
  const { id, secret } = credentials(context.req.header('authorization'), body)
  const invalidClient = () =>
    context.json(failure('invalid_client', 'unknown client or wrong secret'), 401, {
      'www-authenticate': 'Basic realm="oauth"',
    })

  // A client that registered with a secret has to show it; one without proves
  // itself with PKCE alone, and a secret it sends anyway is ignored.
  const client = await clientFor(context.env, id)
  if (!client) return invalidClient()
  if (client.secretHash && (!secret || (await sha256(secret)) !== client.secretHash)) {
    return invalidClient()
  }

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.code_verifier) {
      return context.json(failure('invalid_request', 'code and code_verifier are required'), 400)
    }
    if (!resourceMatches(context.env, body.resource ?? '')) {
      return context.json(
        failure('invalid_target', `this server is ${resourceUrl(context.env)}`),
        400,
      )
    }

    const hash = await sha256(body.code)
    const code = await context.env.DB.prepare(
      'select client_id, user_id, redirect_uri, challenge, read_only, expires_at from oauth_codes where code_hash = ?',
    )
      .bind(hash)
      .first<{
        client_id: string
        user_id: string
        redirect_uri: string
        challenge: string
        read_only: number
        expires_at: number
      }>()

    // A code is good once, however the attempt goes.
    if (code) {
      await context.env.DB.prepare('delete from oauth_codes where code_hash = ?').bind(hash).run()
    }

    if (
      !code ||
      code.expires_at < now() ||
      code.client_id !== client.id ||
      (body.redirect_uri && body.redirect_uri !== code.redirect_uri) ||
      !(await verifierMatches(body.code_verifier, code.challenge))
    ) {
      return context.json(failure('invalid_grant', 'the code is not valid'), 400)
    }

    const grant: Grant = { id: newId(), client_id: client.id, read_only: code.read_only }
    const issued = await issue(context.env, grant)

    await context.env.DB.prepare(
      `insert into oauth_grants
         (id, user_id, client_id, client_name, read_only, access_hash, access_expires_at, refresh_hash, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        grant.id,
        code.user_id,
        client.id,
        client.name,
        code.read_only,
        issued.hashes.access,
        issued.hashes.expiresAt,
        issued.hashes.refresh,
        now(),
      )
      .run()

    return context.json(issued.reply, 200, { 'cache-control': 'no-store' })
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return context.json(failure('invalid_request', 'refresh_token is required'), 400)
    }

    const hash = await sha256(body.refresh_token)
    const grant = await context.env.DB.prepare(
      `select id, client_id, read_only from oauth_grants
        where refresh_hash = ? or previous_refresh_hash = ?`,
    )
      .bind(hash, hash)
      .first<Grant>()

    if (grant?.client_id !== client.id) {
      return context.json(failure('invalid_grant', 'the refresh token is not valid'), 400)
    }

    // The token just shown is the one kept as the fallback: whatever was
    // issued since and never used has plainly not reached the client.
    const issued = await issue(context.env, grant, { refresh_hash: hash })
    return context.json(issued.reply, 200, { 'cache-control': 'no-store' })
  }

  return context.json(failure('unsupported_grant_type', `use one of ${GRANTS.join(', ')}`), 400)
})

/** Looks up a connector request's bearer token among the grants. */
export async function grantForToken(
  env: Env,
  token: string,
): Promise<{ user_id: string; read_only: number } | null> {
  const hash = await sha256(token)
  const row = await env.DB.prepare(
    'select id, user_id, read_only, access_expires_at from oauth_grants where access_hash = ?',
  )
    .bind(hash)
    .first<{ id: string; user_id: string; read_only: number; access_expires_at: number }>()

  if (!row || row.access_expires_at < now()) return null

  await env.DB.prepare('update oauth_grants set last_used_at = ? where id = ?')
    .bind(now(), row.id)
    .run()
  return { user_id: row.user_id, read_only: row.read_only }
}
