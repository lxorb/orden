import { originAt, origins } from '../hosts'
import type { Env } from '../types'

export const SCOPES = ['notes:read', 'notes:write']
export const GRANTS = ['authorization_code', 'refresh_token']

export const issuer = (env: Env, at: string) => originAt(env, at)
export const resourceUrl = (env: Env, at: string) => `${issuer(env, at)}/mcp`

export const failure = (error: string, description: string) => ({
  error,
  error_description: description,
})

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

export function tooLong(ask: Ask): keyof Ask | null {
  return FIELDS.find((field) => ask[field].length > LIMITS[field]) ?? null
}

export const wantsWrite = (ask: Ask) => !ask.scope || ask.scope.split(/\s+/).includes('notes:write')

export function unknownScopes(scope: string): string[] {
  return scope.split(/\s+/).filter((one) => one && !SCOPES.includes(one))
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

export function challengeLooksRight(value: string): boolean {
  return CHALLENGE.test(value)
}

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

export function textFields(parsed: Record<string, unknown>): Record<string, string | undefined> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') fields[key] = value
  }
  return fields
}
