import type { Env } from './types'

/** Certificates for domains people bring, through Cloudflare for SaaS.
 *
 *  The zone that serves the blogs only holds a certificate for its own names.
 *  A domain of someone's own reaches the Worker through a CNAME to
 *  BLOG_CNAME_TARGET, and the edge will only complete the TLS handshake for
 *  it once a "custom hostname" exists for it on the zone with a certificate
 *  of its own. This module asks for one, lets it go, and reports how far
 *  along it is. Validation is over HTTP: Cloudflare serves the token itself
 *  once the CNAME is in place, so the one record is all the owner adds.
 *
 *  The row in `spaces` is the truth throughout. Nothing here can fail a
 *  request; a domain Cloudflare has not heard of yet is asked for again the
 *  next time its status is looked up. */

const API = 'https://api.cloudflare.com/client/v4'

export type DomainState = 'pending' | 'active' | 'error' | 'unconfigured'

export interface DomainStatus {
  state: DomainState
  /** Cloudflare's own words about what it is waiting for or what went wrong. */
  detail: string | null
}

interface CustomHostname {
  id: string
  hostname: string
  status?: string
  ssl?: { status?: string; validation_errors?: { message?: string }[] } | null
  verification_errors?: string[]
}

interface Envelope<T> {
  success: boolean
  errors?: { code: number; message: string }[]
  result?: T | null
}

/** Set as a var and a secret; absent in tests and local development, where
 *  a domain is recorded and nothing is asked of anyone. */
function access(env: Env): { token: string; zone: string } | null {
  return env.CF_API_TOKEN && env.CF_ZONE_ID
    ? { token: env.CF_API_TOKEN, zone: env.CF_ZONE_ID }
    : null
}

async function request<T>(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const { token, zone } = access(env)!
  const response = await fetch(`${API}/zones/${zone}/custom_hostnames${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return (await response.json()) as Envelope<T>
}

async function find(env: Env, domain: string): Promise<CustomHostname | null> {
  const listed = await request<CustomHostname[]>(
    env,
    'GET',
    `?hostname=${encodeURIComponent(domain)}`,
  )
  return listed.result?.find((one) => one.hostname === domain) ?? null
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Asks for a certificate. Safe to repeat: a domain already asked for is left
 *  as it is. Returns Cloudflare's objection when it has one, null otherwise. */
export async function claimDomain(env: Env, domain: string): Promise<string | null> {
  if (!access(env)) return null

  try {
    if (await find(env, domain)) return null

    const created = await request<CustomHostname>(env, 'POST', '', {
      hostname: domain,
      ssl: { method: 'http', type: 'dv' },
    })
    if (created.success) return null

    return created.errors?.[0]?.message ?? 'Cloudflare turned the domain down'
  } catch (error) {
    return reason(error)
  }
}

/** Gives the certificate up. A hostname that cannot be reached right now is
 *  left where it is: the row has already let the domain go, and a hostname
 *  nobody publishes on serves nothing. */
export async function releaseDomain(env: Env, domain: string): Promise<void> {
  if (!access(env)) return

  try {
    const found = await find(env, domain)
    if (found) await request(env, 'DELETE', `/${found.id}`)
  } catch (error) {
    console.warn(`could not release ${domain}: ${reason(error)}`)
  }
}

/** How far along a domain is. Asks for it again when Cloudflare has no record
 *  of it, so a domain set before this ran, or while Cloudflare was down,
 *  catches up the first time anyone looks. */
export async function domainStatus(env: Env, domain: string): Promise<DomainStatus> {
  if (!access(env)) return { state: 'unconfigured', detail: null }

  try {
    const found = await find(env, domain)
    if (found) return describe(found)

    const objection = await claimDomain(env, domain)
    return objection ? { state: 'error', detail: objection } : { state: 'pending', detail: null }
  } catch (error) {
    return { state: 'error', detail: `Cloudflare could not be reached: ${reason(error)}` }
  }
}

function describe(hostname: CustomHostname): DomainStatus {
  const ssl = hostname.ssl?.status ?? ''

  if (hostname.status === 'active' && ssl === 'active') return { state: 'active', detail: null }

  // Taken away again after it worked, or refused outright.
  if (hostname.status === 'moved') return { state: 'error', detail: 'the domain no longer points here' }
  if (hostname.status === 'blocked') {
    return { state: 'error', detail: 'Cloudflare has blocked this domain' }
  }
  if (['validation_timed_out', 'expired', 'deleted'].includes(ssl)) {
    return { state: 'error', detail: `certificate ${ssl.replace(/_/g, ' ')}` }
  }

  // Anything else is on its way. What Cloudflare is waiting for - the CNAME,
  // usually - rides along as a hint, not a failure.
  const waiting =
    hostname.ssl?.validation_errors?.find((one) => one.message)?.message ??
    hostname.verification_errors?.[0] ??
    null

  return { state: 'pending', detail: waiting }
}
