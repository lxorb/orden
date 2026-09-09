/** Who is asking, and how it said so.
 *
 *  Two kinds of client: one that registered itself here (RFC 7591) and has a
 *  row, and one whose id is the URL of its own description (Client ID Metadata
 *  Documents) and has none. Either way the registered callbacks are the only
 *  ones a browser is ever sent to, so this is where they are read and where
 *  they are written down. */

import { Hono } from 'hono'
import { textAtMost } from '../body'
import { newId, now, randomToken, sha256 } from '../crypto'
import { machineOf, mayRegister } from '../limits'
import type { Env } from '../types'
import { failure, GRANTS } from './protocol'
import { fallbackName, privateHost, redirectAllowed } from './redirects'

export interface Client {
  id: string
  name: string
  redirectUris: string[]
  secretHash: string | null
}

/** At least one callback, or there is nowhere to go. The count is capped
 *  because the whole list is stored as one column: a client that registered
 *  ten thousand callbacks would otherwise write a row of any size it liked. */
const MOST_REDIRECTS = 20
const LONGEST_URI = 2048

/** How many clients this server keeps registered at once. Far above the number
 *  of LLM clients there are, and a number: without one, an endpoint anybody may
 *  post to is a table anybody may fill. Reached only if the sweep below cannot
 *  keep up, which is why the answer to it is "not right now" rather than "no". */
const MOST_CLIENTS = 5_000

/** How long a client nothing is connected through and nothing has used is kept.
 *  Long enough that somebody coming back to a client they set up last month
 *  finds it as they left it. */
const UNUSED_FOR = 30 * 24 * 60 * 60 * 1000
/** A description document is small. Anything larger is not one. */
const LONGEST_DOCUMENT = 64_000

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function uriList(value: unknown): [string, ...string[]] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MOST_REDIRECTS) return null
  if (!value.every((one) => typeof one === 'string' && one.length <= LONGEST_URI)) return null
  return value as [string, ...string[]]
}

/** A client whose id is a URL keeps its description there. The document is read
 *  afresh each time: it is small, the hosts that use this are few, and there is
 *  nowhere sensible to cache it. */
async function clientFromDocument(id: string): Promise<Client | null> {
  let url: URL
  try {
    url = new URL(id)
  } catch {
    return null
  }

  // The draft insists on HTTPS and a path, which keeps a bare origin from
  // being mistaken for one. A host that is an address, or this machine, is not
  // somewhere a client publishes anything: an id naming one would only be a
  // way to have this server fetch it.
  if (url.protocol !== 'https:' || url.pathname === '/' || url.hash) return null
  if (privateHost(url.hostname)) return null

  try {
    const response = await fetch(id, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    // Read up to the limit rather than read and then measured. Anybody at all can
    // name the URL this fetches - `/oauth/authorize` takes the id from a query
    // string - so a host answering with something enormous must not be able to
    // spend this Worker's memory on it.
    const text = await textAtMost(response, LONGEST_DOCUMENT)
    if (text === null) return null

    const document = JSON.parse(text) as Record<string, unknown>
    if (document.client_id !== id) return null

    const redirectUris = uriList(document.redirect_uris)
    if (!redirectUris?.every(redirectAllowed)) return null

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

export async function clientFor(env: Env, id: string): Promise<Client | null> {
  if (!id || id.length > LONGEST_URI) return null
  if (/^https:\/\//i.test(id)) return clientFromDocument(id)

  const row = await env.DB.prepare(
    'select id, name, redirect_uris, secret_hash from oauth_clients where id = ?',
  )
    .bind(id)
    .first<{ id: string; name: string; redirect_uris: string; secret_hash: string | null }>()

  if (!row) return null

  // The column is written by the route below and by nothing else, so a row
  // whose list does not read back is a corrupt row: no callbacks, no client,
  // rather than an exception on the way out.
  const registered = uriList(parseJson(row.redirect_uris))
  if (!registered) return null

  return {
    id: row.id,
    name: row.name,
    redirectUris: registered,
    secretHash: row.secret_hash,
  }
}

/** Registration, RFC 7591. Public clients, which is what LLM clients are:
 *  PKCE is their proof, not a secret. One that asks for a secret gets one. */
export const registration = new Hono<{ Bindings: Env }>()

registration.post('/register', async (context) => {
  const parsed = await context.req.json<unknown>().catch(() => null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return context.json(failure('invalid_client_metadata', 'send a JSON object'), 400)
  }
  const body = parsed as Record<string, unknown>

  const redirectUris = uriList(body.redirect_uris)
  if (!redirectUris) {
    return context.json(
      failure('invalid_redirect_uri', `redirect_uris is required, up to ${MOST_REDIRECTS} of them`),
      400,
    )
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
    // Both ceilings sit here rather than at the top, because they are about rows
    // being written: a client asking again for the row it already has is not one
    // more client, and holding it to a number would break the clients that
    // register on every connection.
    const held = await context.env.DB.prepare('select count(*) as many from oauth_clients').first<{
      many: number
    }>()

    if ((held?.many ?? 0) >= MOST_CLIENTS) {
      return context.json(
        failure('temporarily_unavailable', 'this server is not taking new clients right now'),
        503,
      )
    }

    if (!(await mayRegister(context.env, machineOf(context.req)))) {
      return context.json(
        failure('temporarily_unavailable', 'too many registrations from here, try again later'),
        429,
      )
    }

    await context.env.DB.prepare(
      `insert into oauth_clients (id, name, redirect_uris, secret_hash, created_at, used_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, name, uris, secret ? await sha256(secret) : null, createdAt, createdAt)
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

/** A client was used to start a sign-in, which is what keeps it out of the sweep
 *  below. A client that describes itself at a URL has no row and no stamp; the
 *  statement matches nothing and that is the right answer for one. */
export function clientWasUsed(env: Env, id: string): Promise<unknown> {
  return env.DB.prepare('update oauth_clients set used_at = ? where id = ?').bind(now(), id).run()
}

/** Registered clients nothing is connected through and nothing has used for a
 *  month, let go. Part of the nightly job, beside Recently deleted.
 *
 *  Three things keep a client: a grant, which is somebody's live connection; a
 *  code, which is a connection halfway through being made; and having been used
 *  lately, which covers a client somebody keeps in a config file and signs in
 *  with now and then. What is left is a registration that led nowhere, and the
 *  client it belonged to can register again in one request if it ever comes
 *  back. */
export async function expireClients(env: Env, at: number): Promise<number> {
  const gone = await env.DB.prepare(
    `delete from oauth_clients
      where coalesce(used_at, created_at) < ?
        and not exists (select 1 from oauth_grants where client_id = oauth_clients.id)
        and not exists (select 1 from oauth_codes where client_id = oauth_clients.id)`,
  )
    .bind(at - UNUSED_FOR)
    .run()

  return gone.meta.changes
}
