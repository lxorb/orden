import type { Env } from './types'

const API = 'https://api.cloudflare.com/client/v4'

type DomainState = 'pending' | 'active' | 'error' | 'unconfigured'

export interface DomainStatus {
  state: DomainState
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

function access(env: Env): Access | null {
  return env.CF_API_TOKEN && env.CF_ZONE_ID
    ? { token: env.CF_API_TOKEN, zone: env.CF_ZONE_ID }
    : null
}

interface Access {
  token: string
  zone: string
}

async function request<T>(
  access: Access,
  method: string,
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const response = await fetch(`${API}/zones/${access.zone}/custom_hostnames${path}`, {
    method,
    headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  return await response.json<Envelope<T>>()
}

async function find(access: Access, domain: string): Promise<CustomHostname | null> {
  const listed = await request<CustomHostname[]>(
    access,
    'GET',
    `?hostname=${encodeURIComponent(domain)}`,
  )
  return listed.result?.find((one) => one.hostname === domain) ?? null
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function claimDomain(env: Env, domain: string): Promise<string | null> {
  const reachable = access(env)
  if (!reachable) return null

  try {
    if (await find(reachable, domain)) return null

    const created = await request<CustomHostname>(reachable, 'POST', '', {
      hostname: domain,
      ssl: { method: 'http', type: 'dv' },
    })
    if (created.success) return null

    return created.errors?.[0]?.message ?? 'Cloudflare turned the domain down'
  } catch (error) {
    return reason(error)
  }
}

export async function releaseDomain(env: Env, domain: string): Promise<void> {
  const reachable = access(env)
  if (!reachable) return

  try {
    const found = await find(reachable, domain)
    if (found) await request(reachable, 'DELETE', `/${found.id}`)
  } catch (error) {
    console.warn(`could not release ${domain}: ${reason(error)}`)
  }
}

export async function domainStatus(env: Env, domain: string): Promise<DomainStatus> {
  const reachable = access(env)
  if (!reachable) return { state: 'unconfigured', detail: null }

  try {
    const found = await find(reachable, domain)
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

  if (hostname.status === 'moved')
    return { state: 'error', detail: 'the domain no longer points here' }
  if (hostname.status === 'blocked') {
    return { state: 'error', detail: 'Cloudflare has blocked this domain' }
  }
  if (['validation_timed_out', 'expired', 'deleted'].includes(ssl)) {
    return { state: 'error', detail: `certificate ${ssl.replace(/_/g, ' ')}` }
  }

  const waiting =
    hostname.ssl?.validation_errors?.find((one) => one.message)?.message ??
    hostname.verification_errors?.[0] ??
    null

  return { state: 'pending', detail: waiting }
}
