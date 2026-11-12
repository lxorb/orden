import { createHash } from 'node:crypto'
import app from '../src'
import type { Env } from '../src/sync-server/src/types'
import { type TestEnv, testEnv } from '../src/sync-server/test/fakes'

export { type TestEnv, testEnv }

interface UserView {
  id: string
  email: string
  name: string | null
}

interface DnsRecord {
  type: string
  name: string
  value: string
  note?: string
}

interface BookmarkView {
  kind: string
  path: string
  text: string
}

interface SpaceFileView {
  path: string
  hash: string
}

interface SpaceView {
  id: string
  name: string
  position: number
  icon: string | null
  tint: string | null
  role: string
  shared: boolean
  sharedItems: string[]
  onceShared?: boolean
  onceSharedItems?: string[]
  bookmarks: BookmarkView[]
  icons: Record<string, string>
  tints: Record<string, string>
  graph: Record<string, unknown>
  excluded: string[]
  arranged: Record<string, string[]>
  sort: string
  archived: Record<string, number>
  createdAt: number
  updatedAt: number
  blog: {
    enabled: boolean
    subdomain: string | null
    domain: string | null
    title: string | null
    note: string | null
    dns: DnsRecord[]
    site: {
      rules: { include: string[]; exclude: string[]; otherwise: string }
      description?: string
      image?: string
      icon?: string
      password: boolean
    }
  }
}

interface NoteView {
  id: string
  path: string
  seq: number
  version: number
  updatedAt: number
  deleted: boolean
  size: number
  hash: string
}

interface ClientView {
  id: string
  name: string
  readOnly: boolean
  createdAt: number
  lastUsedAt: number | null
}

export interface Reply {
  error: string
  error_description: string
  ok: boolean

  token: string
  user: UserView
  resendIn: number
  settings: Record<string, unknown>
  password: { hash: string } | null

  key: { set: boolean; tail: string }
  set: boolean
  tail: string
  models: string[]
  answer: string
  said: string | null
  language: string

  used: number
  limit: number
  hash: string
  stored: boolean

  answers: { id: string; note: string; path: string; at: number; answers: Record<string, string> }[]

  pages: number
  before: number
  adds: string[]
  removes: string[]

  space: SpaceView
  spaces: SpaceView[]
  bookmarks: BookmarkView[]
  icons: Record<string, string>
  tints: Record<string, string>
  graph: Record<string, unknown>
  excluded: string[]
  arranged: Record<string, string[]>
  archived: Record<string, number>
  files: SpaceFileView[]
  missing: string[]
  deleted: string[]
  available: boolean
  reason: string
  domain: string | null
  state: string
  detail: string | null
  dns: DnsRecord[]

  waiting: boolean
  declined: boolean
  guest: { id: string; name: string }

  note: NoteView
  notes: NoteView[]
  content: string
  cursor: number
  more: boolean

  exists: boolean
  readOnly: boolean
  createdAt: number | null
  lastUsedAt: number | null
  clients: ClientView[]

  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  response_types_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
  client_id_metadata_document_supported: boolean
  authorization_response_iss_parameter_supported: boolean
  resource: string
  resource_name: string
  authorization_servers: string[]

  client_id: string
  client_secret: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string

  sites: { site: string; label: string; seen: number; hash: string | null }[]
}

export interface ShareView {
  owner: { email: string; name: string | null }
  item: { id: string; path: string } | null
  members: {
    email: string | null
    guest: string | null
    name: string | null
    role: string
    pending: boolean
  }[]
  requests: {
    email: string | null
    guest: string | null
    name: string | null
    role: string
    at: number
  }[]
  link: { url: string; role: string; mode: string } | null
  mailed: boolean
  error: string
}

export interface JoinView {
  kind: string
  space: string
  note: string | null
  role: string
  email: string | null
  asks: boolean
  from: string | null
  error: string
}

export interface TrashView {
  spaces: { id: string; name: string; deletedAt: number; purgeAt: number; notes: number }[]
  notes: {
    id: string
    spaceId: string
    spaceName: string
    path: string
    deletedAt: number
    purgeAt: number
  }[]
}

export interface RpcView {
  jsonrpc: string
  id: number | string | null
  result: {
    protocolVersion: string
    capabilities: { tools: Record<string, unknown> }
    serverInfo: { name: string; version: string }
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
    content: { type: string; text: string }[]
    isError?: boolean
  }
  error: { code: number; message: string }
}

interface CallOptions {
  method?: string
  body?: unknown
  raw?: BodyInit
  headers?: Record<string, string>
  token?: string
  host?: string
}

export interface Answer<T> {
  status: number
  json: T
  text: string
  headers: Headers
}

export async function call<T = Reply>(
  env: Env,
  path: string,
  options: CallOptions = {},
): Promise<Answer<T>> {
  const host = options.host ?? 'nibeditor.com'
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  Object.assign(headers, options.headers ?? {})

  const method =
    options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST')
  const body = options.raw ?? (options.body === undefined ? null : JSON.stringify(options.body))

  const response = await app.fetch(
    new Request(`https://${host}${path}`, { method, headers, body }),
    env,
  )

  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // Blog responses are HTML.
  }

  return { status: response.status, json: json as T, text, headers: response.headers }
}

export async function mail(work: () => Promise<unknown>): Promise<string> {
  const logged: string[] = []
  const original = console.log
  console.log = (message: string) => {
    logged.push(message)
  }

  try {
    await work()
  } finally {
    console.log = original
  }

  return logged.join('\n')
}

export async function signIn(env: Env, email: string, guest?: string): Promise<string> {
  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email } }))

  const code = /(\d{3}) (\d{3})/.exec(logged)
  if (!code) throw new Error(`no code was sent:\n${logged}`)

  const verified = await call(env, '/v1/auth/verify', {
    body: { email, code: `${code[1]}${code[2]}`, ...(guest ? { guest } : {}) },
  })

  if (verified.status !== 200) throw new Error(`sign-in failed: ${verified.text}`)
  return verified.json.token
}

export function file(size: number, seed = 0): { bytes: Uint8Array; hash: string } {
  const bytes = new Uint8Array(size).fill(seed)
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}
