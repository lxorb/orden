/** The vocabulary every part of the OAuth server shares: what this server is
 *  called, which scopes exist, how a failure is worded, and the fields of an
 *  authorization request as they travel from the query string through the
 *  consent page's forms and into the code. */

import { originAt, origins } from '../hosts'
import type { Env } from '../types'

export const SCOPES = ['notes:read', 'notes:write']
export const GRANTS = ['authorization_code', 'refresh_token']

/** Who this server is, said in the name the request reached it at: `at` is the
 *  request's URL. A connector added under one of the service's names checks
 *  every answer against that name - the issuer of the metadata it fetched, the
 *  `iss` on the redirect, the resource it asked for - so each name answers as
 *  itself. A token is a row in the one database, and good under either. */
export const issuer = (env: Env, at: string) => originAt(env, at)
export const resourceUrl = (env: Env, at: string) => `${issuer(env, at)}/mcp`

/** An OAuth error object, which is what every failure here looks like. */
export const failure = (error: string, description: string) => ({
  error,
  error_description: description,
})

/** The fields of an authorization request that travel through the consent
 *  page's forms and into the code. */
export interface Ask {
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  scope: string
  resource: string
}

export const FIELDS: (keyof Ask)[] = [
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'scope',
  'resource',
]

/** How long each may be. Nothing here is stored beyond the code, but every one
 *  of them is written into a page or a redirect, and a field that may be any
 *  length is a field somebody will make a megabyte. */
const LIMITS: Record<keyof Ask, number> = {
  client_id: 2048,
  redirect_uri: 2048,
  state: 1024,
  code_challenge: 128,
  scope: 512,
  resource: 2048,
}

export function askFrom(source: Record<string, string | undefined>): Ask {
  const ask = {} as Ask
  for (const field of FIELDS) ask[field] = source[field] ?? ''
  return ask
}

/** The first field that is longer than it may be, if any. */
export function tooLong(ask: Ask): keyof Ask | null {
  return FIELDS.find((field) => ask[field].length > LIMITS[field]) ?? null
}

/** Whether the client asked to write. Asking for nothing means everything,
 *  which is what a client that read no scopes anywhere does. */
export const wantsWrite = (ask: Ask) => !ask.scope || ask.scope.split(/\s+/).includes('notes:write')

/** The scopes named that this server has never heard of. */
export function unknownScopes(scope: string): string[] {
  return scope.split(/\s+/).filter((one) => one && !SCOPES.includes(one))
}

/** PKCE with S256: the challenge is the base64url of a SHA-256 digest, which
 *  is always these 43 characters. Checked here rather than only at the token
 *  endpoint, so a client that sends something else is told at once instead of
 *  being handed a code that could never be exchanged. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

export function challengeLooksRight(value: string): boolean {
  return CHALLENGE.test(value)
}

/** The resource the token is for must be this connector, under any of its
 *  names, when named at all. Case in the host and a trailing slash are
 *  forgiven, as the spec advises. */
export function resourceMatches(env: Env, given: string): boolean {
  if (!given) return true
  const canonical = (uri: string) => {
    try {
      const parsed = new URL(uri)
      return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`
    } catch {
      return uri
    }
  }
  return origins(env).some((origin) => canonical(given) === canonical(`${origin}/mcp`))
}

/** The text fields of a submitted body. A file, or a field sent twice, is not
 *  something any of these endpoints has; such a value is dropped rather than
 *  stringified into nonsense. */
export function textFields(parsed: Record<string, unknown>): Record<string, string | undefined> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') fields[key] = value
  }
  return fields
}
