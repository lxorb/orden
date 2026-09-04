/** The OAuth server in front of the connector, so an LLM client can be given
 *  the URL and sign the person in by itself - nothing to copy anywhere.
 *
 *  A client finds everything on its own: where the endpoints are (RFC 8414 and
 *  RFC 9728), how to introduce itself (by registering, RFC 7591, or with an id
 *  that is the URL of its own description), and the code flow with PKCE that
 *  OAuth 2.1 and the MCP specification ask for. Signing in is the same emailed
 *  code as the app, on a page rendered here. */

import { type Context, Hono } from 'hono'
import { sendCode, verifyCode } from './auth'
import { newId, normaliseEmail, now, randomToken, sha256 } from './crypto'
import type { Env } from './types'

const SCOPES = ['notes:read', 'notes:write']
const CODE_TTL = 10 * 60 * 1000
/** Long enough that a client is not forever refreshing; short enough that a
 *  token found somewhere is soon worthless. Clients refresh without asking. */
const ACCESS_TTL = 24 * 60 * 60 * 1000
const GRANTS = ['authorization_code', 'refresh_token']

const issuer = (env: Env) => env.APP_ORIGIN
const resourceUrl = (env: Env) => `${env.APP_ORIGIN}/mcp`

/* ── Where the client may be sent back to ─────────────────────────────── */

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

/** Editors that answer on a scheme of their own rather than a port. */
const NATIVE_SCHEMES = ['cursor://', 'vscode://', 'vscode-insiders://', 'windsurf://']

/** Anything else must be HTTPS, as OAuth 2.1 requires; the consent page names
 *  the host either way, so a person sees where they are about to be sent. */
export function redirectAllowed(uri: string): boolean {
  if (LOOPBACK.test(uri)) return true
  if (NATIVE_SCHEMES.some((scheme) => uri.toLowerCase().startsWith(scheme))) return true

  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' && !parsed.hash
  } catch {
    return false
  }
}

/** A native client listens on whichever port was free when it started, so a
 *  loopback address matches with the port left out (RFC 8252, 7.3). */
function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true
  if (!LOOPBACK.test(registered) || !LOOPBACK.test(given)) return false

  const withoutPort = (uri: string) => uri.replace(/^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d+/i, '$1')
  return withoutPort(registered) === withoutPort(given)
}

/** How the consent page describes the destination. */
function describeDestination(uri: string): string {
  if (LOOPBACK.test(uri)) return 'an app on this computer'

  const scheme = NATIVE_SCHEMES.find((one) => uri.toLowerCase().startsWith(one))
  if (scheme) return `the ${scheme.slice(0, -3)} app`

  try {
    return new URL(uri).hostname
  } catch {
    return uri
  }
}

/** A name for a client that gave none: its host, or something that still
 *  reads as a sentence on the consent page. */
function fallbackName(uri: string): string {
  if (LOOPBACK.test(uri)) return 'the app'
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' ? parsed.hostname : 'the app'
  } catch {
    return 'the app'
  }
}

/* ── Clients ──────────────────────────────────────────────────────────── */

interface Client {
  id: string
  name: string
  redirectUris: string[]
  secretHash: string | null
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
}

function uriList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((one) => typeof one === 'string' && one.length <= 2048)) return null
  return value as string[]
}

/** A client whose id is a URL keeps its description there (Client ID Metadata
 *  Documents). The document is read afresh each time: it is small, the hosts
 *  that use this are few, and there is nowhere sensible to cache it. */
async function clientFromDocument(id: string): Promise<Client | null> {
  let url: URL
  try {
    url = new URL(id)
  } catch {
    return null
  }

  // The draft insists on HTTPS and a path, which keeps a bare origin from
  // being mistaken for one.
  if (url.protocol !== 'https:' || url.pathname === '/' || url.hash) return null

  try {
    const response = await fetch(id, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const text = await response.text()
    if (text.length > 64_000) return null

    const document = JSON.parse(text) as Record<string, unknown>
    if (document.client_id !== id) return null

    const redirectUris = uriList(document.redirect_uris)
    if (!redirectUris || !redirectUris.every(redirectAllowed)) return null

    return {
      id,
      name: cleanName(document.client_name) || url.hostname,
      redirectUris,
      secretHash: null,
    }
  } catch {
    return null
  }
}

async function clientFor(env: Env, id: string): Promise<Client | null> {
  if (!id) return null
  if (/^https:\/\//i.test(id)) return clientFromDocument(id)

  const row = await env.DB.prepare(
    'select id, name, redirect_uris, secret_hash from oauth_clients where id = ?',
  )
    .bind(id)
    .first<{ id: string; name: string; redirect_uris: string; secret_hash: string | null }>()

  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    secretHash: row.secret_hash,
  }
}

/* ── What the client is told about the server ─────────────────────────── */

export const oauthMetadata = new Hono<{ Bindings: Env }>()

oauthMetadata.get('/oauth-authorization-server', (context) => {
  const base = issuer(context.env)

  return context.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: GRANTS,
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES,
    client_id_metadata_document_supported: true,
    // The `iss` on every redirect is what lets ChatGPT use one fixed callback
    // rather than one per connector.
    authorization_response_iss_parameter_supported: true,
  })
})

/** The same document at the plain path and at the one with the connector's
 *  path folded in: RFC 9728 asks for the second, older clients try the first. */
function protectedResource(env: Env) {
  return {
    resource: resourceUrl(env),
    authorization_servers: [issuer(env)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Nib',
  }
}

oauthMetadata.get('/oauth-protected-resource', (context) => context.json(protectedResource(context.env)))
oauthMetadata.get('/oauth-protected-resource/mcp', (context) => context.json(protectedResource(context.env)))

/** What a refused connector request carries, so a client knows where to go. */
export function challenge(env: Env, invalid: boolean): string {
  const parts = [
    `resource_metadata="${issuer(env)}/.well-known/oauth-protected-resource/mcp"`,
    `scope="${SCOPES.join(' ')}"`,
  ]
  if (invalid) parts.unshift('error="invalid_token"')
  return `Bearer ${parts.join(', ')}`
}

/* ── The endpoints ────────────────────────────────────────────────────── */

export const oauth = new Hono<{ Bindings: Env }>()

const failure = (error: string, description: string) => ({
  error,
  error_description: description,
})

/** Registration, RFC 7591. Public clients, which is what LLM clients are:
 *  PKCE is their proof, not a secret. One that asks for a secret gets one. */
oauth.post('/register', async (context) => {
  const body = await context.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') {
    return context.json(failure('invalid_client_metadata', 'send a JSON object'), 400)
  }

  const redirectUris = uriList(body.redirect_uris)
  if (!redirectUris) {
    return context.json(failure('invalid_redirect_uri', 'redirect_uris is required'), 400)
  }

  const refused = redirectUris.find((uri) => !redirectAllowed(uri))
  if (refused) {
    return context.json(
      failure('invalid_redirect_uri', `${refused} is not https, localhost or a known app`),
      400,
    )
  }

  const method = body.token_endpoint_auth_method
  const wantsSecret = typeof method === 'string' && method !== 'none'
  const name = cleanName(body.client_name) || fallbackName(redirectUris[0])
  const uris = JSON.stringify(redirectUris)

  // Some clients register anew on every connection. Two public clients that
  // look the same are the same, so those get the same id back rather than a
  // table that grows by one row per conversation.
  const existing = wantsSecret
    ? null
    : await context.env.DB.prepare(
        'select id, created_at from oauth_clients where name = ? and redirect_uris = ? and secret_hash is null',
      )
        .bind(name, uris)
        .first<{ id: string; created_at: number }>()

  const id = existing?.id ?? newId()
  const secret = wantsSecret ? randomToken() : null
  const createdAt = existing?.created_at ?? now()

  if (!existing) {
    await context.env.DB.prepare(
      'insert into oauth_clients (id, name, redirect_uris, secret_hash, created_at) values (?, ?, ?, ?, ?)',
    )
      .bind(id, name, uris, secret ? await sha256(secret) : null, createdAt)
      .run()
  }

  return context.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(createdAt / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: !secret
        ? 'none'
        : method === 'client_secret_basic'
          ? 'client_secret_basic'
          : 'client_secret_post',
      grant_types: GRANTS,
      response_types: ['code'],
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    },
    201,
  )
})

/** The fields of an authorization request that travel through the consent
 *  page's forms and into the code. */
interface Ask {
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  scope: string
  resource: string
}

const FIELDS: (keyof Ask)[] = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'scope', 'resource']

function askFrom(source: Record<string, string | undefined>): Ask {
  const ask = {} as Ask
  for (const field of FIELDS) ask[field] = (source[field] ?? '').toString()
  return ask
}

/** The resource the token is for must be this connector, when named at all.
 *  Case in the host and a trailing slash are forgiven, as the spec advises. */
function resourceMatches(env: Env, given: string): boolean {
  if (!given) return true
  const canonical = (uri: string) => {
    try {
      const parsed = new URL(uri)
      return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`
    } catch {
      return uri
    }
  }
  return canonical(given) === canonical(resourceUrl(env))
}

/** Sends the browser back to the client with whatever happened. The issuer
 *  rides along (RFC 9207) so the client can tell this server's answer from an
 *  impostor's. */
function backToClient(env: Env, ask: Ask, params: Record<string, string>): Response {
  const url = new URL(ask.redirect_uri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (ask.state) url.searchParams.set('state', ask.state)
  url.searchParams.set('iss', issuer(env))

  return new Response(null, { status: 302, headers: { location: url.toString() } })
}

/** Checks the part of a request that decides whether the browser may be sent
 *  anywhere at all. A bad client or a redirect it never registered is shown
 *  on a page, never forwarded: that is how open redirects happen. */
async function checkClient(env: Env, ask: Ask): Promise<{ client: Client } | { problem: string }> {
  const client = await clientFor(env, ask.client_id)
  if (!client) return { problem: 'This app is not known here. Add the connector again in the app.' }

  if (!ask.redirect_uri || !client.redirectUris.some((one) => sameRedirect(one, ask.redirect_uri))) {
    return { problem: `${client.name} asked to be sent somewhere it did not register.` }
  }

  return { client }
}

/** Checks the rest, whose failures go back to the client as OAuth errors. */
function checkRequest(env: Env, ask: Ask, query: Record<string, string | undefined>): Record<string, string> | null {
  if (query.response_type !== 'code') {
    return failure('unsupported_response_type', 'only the code flow is supported')
  }
  if (!ask.code_challenge || (query.code_challenge_method ?? 'S256') !== 'S256') {
    return failure('invalid_request', 'PKCE with S256 is required')
  }
  if (!resourceMatches(env, ask.resource)) {
    return failure('invalid_target', `this server is ${resourceUrl(env)}`)
  }
  const unknown = ask.scope.split(/\s+/).filter((one) => one && !SCOPES.includes(one))
  if (unknown.length) return failure('invalid_scope', `unknown scope ${unknown[0]}`)

  return null
}

/** Whether the client asked to write. Asking for nothing means everything,
 *  which is what a client that read no scopes anywhere does. */
const wantsWrite = (ask: Ask) => !ask.scope || ask.scope.split(/\s+/).includes('notes:write')

oauth.get('/authorize', async (context) => {
  const query = context.req.query()
  const ask = askFrom(query)

  const checked = await checkClient(context.env, ask)
  if ('problem' in checked) return page(context.env, refusal(checked.problem), 400)

  const problem = checkRequest(context.env, ask, query)
  if (problem) return backToClient(context.env, ask, problem)

  return page(context.env, emailStep(checked.client, ask, {}))
})

oauth.post('/authorize', async (context) => {
  const form = Object.fromEntries(
    Object.entries(await context.req.parseBody()).map(([key, value]) => [key, String(value)]),
  ) as Record<string, string>
  const ask = askFrom(form)

  // Nothing in a form is trusted more than a query string: the same checks,
  // against the same record of what the client registered.
  const checked = await checkClient(context.env, ask)
  if ('problem' in checked) return page(context.env, refusal(checked.problem), 400)
  const { client } = checked

  if (!ask.code_challenge || !resourceMatches(context.env, ask.resource)) {
    return page(context.env, refusal('This request is not complete. Start again from the app.'), 400)
  }

  const email = normaliseEmail(form.email ?? '')

  if (form.action === 'deny') {
    return backToClient(context.env, ask, failure('access_denied', 'the person said no'))
  }

  if (form.action === 'send') {
    const sent = await sendCode(context.env, email)
    if ('error' in sent) return page(context.env, emailStep(client, ask, { email, error: sent.error }))
    return page(context.env, codeStep(client, ask, { email }))
  }

  if (form.action === 'allow') {
    const verified = await verifyCode(context.env, email, form.code ?? '')
    if ('error' in verified) {
      return page(context.env, codeStep(client, ask, { email, error: verified.error }))
    }

    const readOnly = !(wantsWrite(ask) && form.write === '1')
    const code = randomToken()

    await context.env.DB.prepare(
      `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, read_only, expires_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        await sha256(code),
        client.id,
        verified.user.id,
        ask.redirect_uri,
        ask.code_challenge,
        readOnly ? 1 : 0,
        now() + CODE_TTL,
      )
      .run()

    return backToClient(context.env, ask, { code })
  }

  return page(context.env, refusal('That is not something this page does.'), 400)
})

/* ── Tokens ───────────────────────────────────────────────────────────── */

/** Token requests come form-encoded, as RFC 6749 says; JSON is taken too,
 *  because some clients send it anyway. */
async function tokenBody(context: Context<{ Bindings: Env }>): Promise<Record<string, string>> {
  const type = context.req.header('content-type') ?? ''
  const raw: Record<string, unknown> = type.includes('json')
    ? await context.req.json<Record<string, unknown>>().catch(() => ({}))
    : await context.req.parseBody().catch(() => ({}))

  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value)]))
}

/** The client's id and, if it has one, its secret: in the body or, for
 *  `client_secret_basic`, in the Authorization header. */
function credentials(header: string | undefined, body: Record<string, string>): { id: string; secret: string } {
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
  const hashes = { access: await sha256(access), refresh: await sha256(refresh), expiresAt: now() + ACCESS_TTL }

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

oauth.post('/token', async (context) => {
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
  if (client.secretHash && (!secret || (await sha256(secret)) !== client.secretHash)) return invalidClient()

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.code_verifier) {
      return context.json(failure('invalid_request', 'code and code_verifier are required'), 400)
    }
    if (!resourceMatches(context.env, body.resource ?? '')) {
      return context.json(failure('invalid_target', `this server is ${resourceUrl(context.env)}`), 400)
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
    if (code) await context.env.DB.prepare('delete from oauth_codes where code_hash = ?').bind(hash).run()

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
    const tokens = await issue(context.env, grant)

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
        tokens.hashes.access,
        tokens.hashes.expiresAt,
        tokens.hashes.refresh,
        now(),
      )
      .run()

    return context.json(tokens.reply, 200, { 'cache-control': 'no-store' })
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

    if (!grant || grant.client_id !== client.id) {
      return context.json(failure('invalid_grant', 'the refresh token is not valid'), 400)
    }

    // The token just shown is the one kept as the fallback: whatever was
    // issued since and never used has plainly not reached the client.
    const tokens = await issue(context.env, grant, { refresh_hash: hash })
    return context.json(tokens.reply, 200, { 'cache-control': 'no-store' })
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

  await env.DB.prepare('update oauth_grants set last_used_at = ? where id = ?').bind(now(), row.id).run()
  return { user_id: row.user_id, read_only: row.read_only }
}

/* ── The consent page ─────────────────────────────────────────────────── */

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string,
  )
}

/** The app's own palette, both ways round, so the page reads as Nib's. */
const STYLE = `
:root{--bg:#fbfcfd;--fg:#1a1d23;--strong:#0e1013;--muted:#6b7482;--line:#e1e6ed;--line-strong:#ccd4de;--surface:#f3f5f8;--accent:#5b4be0;--accent-hover:#4e3ed6;--danger:#d92b34}
@media(prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#c9cfd8;--strong:#eef1f5;--muted:#8a93a2;--line:#232830;--line-strong:#2f3641;--surface:#14171c;--accent:#7c6bf5;--accent-hover:#8d7ef7;--danger:#f2555a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:min(100% - 2rem,24rem);padding:2rem 0 3rem}
.brand{font-weight:700;letter-spacing:-.02em;color:var(--accent);margin-bottom:2rem}
h1{font-size:1.45em;line-height:1.25;letter-spacing:-.015em;margin:0 0 .5rem;color:var(--strong)}
p{margin:0 0 1.25rem}
label{display:block;font-size:.9em;color:var(--muted);margin-bottom:.35rem}
input[type=email],input[type=text]{width:100%;padding:.7rem .85rem;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--strong);font:inherit;outline:none}
input:focus{border-color:var(--accent)}
input.code{font-size:1.5em;letter-spacing:.35em;text-align:center;font-family:ui-monospace,monospace}
.field{margin-bottom:1.25rem}
.check{display:flex;gap:.6rem;align-items:flex-start;color:var(--fg);font-size:1em;margin:0 0 1.5rem}
.check input{margin:.3em 0 0;accent-color:var(--accent)}
.check small{display:block;color:var(--muted);font-size:.86em}
.actions{display:flex;gap:.75rem;align-items:center}
button{padding:.65rem 1.1rem;border:0;border-radius:9px;font:inherit;font-weight:550;background:var(--accent);color:#fff;cursor:pointer}
button:hover{background:var(--accent-hover)}
button.quiet{background:none;color:var(--muted)}
button.quiet:hover{background:none;color:var(--fg)}
.where{margin-top:2rem;font-size:.86em;color:var(--muted)}
.error{color:var(--danger);font-size:.9em;margin:-.75rem 0 1rem}
`

function page(env: Env, body: string, status: 200 | 400 = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Nib</title>
<style>${STYLE}</style>
<main>
<div class="brand"><a href="${escape(env.APP_ORIGIN)}" style="color:inherit;text-decoration:none">Nib</a></div>
${body}
</main>
</html>`

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Consent must not be collectable through a frame on someone else's page.
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    },
  })
}

function refusal(problem: string): string {
  return `<h1>That did not work</h1><p>${escape(problem)}</p>`
}

/** Server messages are lowercase so the app can drop them into a sentence;
 *  here they stand alone. */
function sentence(text: string): string {
  return `<p class="error">${escape(text.charAt(0).toUpperCase() + text.slice(1))}.</p>`
}

function hidden(ask: Ask, extra: Record<string, string> = {}): string {
  return [...FIELDS.map((field) => [field, ask[field]] as const), ...Object.entries(extra)]
    .filter(([, value]) => value)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`)
    .join('')
}

const wants = (client: Client, ask: Ask) =>
  wantsWrite(ask)
    ? `${escape(client.name)} would like to read your notes, and to change them if you let it.`
    : `${escape(client.name)} would like to read your notes.`

function emailStep(client: Client, ask: Ask, given: { email?: string; error?: string }): string {
  return `<h1>Connect ${escape(client.name)}</h1>
<p>${wants(client, ask)} Sign in to allow it.</p>
<form method="post" action="/oauth/authorize">
${hidden(ask)}
<div class="field"><label for="email">Email</label>
<input type="email" id="email" name="email" value="${escape(given.email ?? '')}" required autofocus autocomplete="email" spellcheck="false"></div>
${given.error ? sentence(given.error) : ''}
<div class="actions"><button name="action" value="send">Continue</button><button class="quiet" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>
<p class="where">Afterwards you go back to ${escape(describeDestination(ask.redirect_uri))}.</p>`
}

function codeStep(client: Client, ask: Ask, given: { email: string; error?: string }): string {
  const write = wantsWrite(ask)
    ? `<label class="check"><input type="checkbox" name="write" value="1">
<span>Let ${escape(client.name)} change my notes as well<small>Without this it can only read them.</small></span></label>`
    : ''

  return `<h1>Check your email</h1>
<p>We sent a six-digit code to <b>${escape(given.email)}</b>.</p>
<form method="post" action="/oauth/authorize">
${hidden(ask, { email: given.email })}
<div class="field"><label for="code">Code</label>
<input type="text" class="code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus></div>
${given.error ? sentence(given.error) : ''}
${write}
<div class="actions"><button name="action" value="allow">Allow</button><button class="quiet" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>
<p class="where">Afterwards you go back to ${escape(describeDestination(ask.redirect_uri))}.</p>`
}
