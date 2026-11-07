import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import app from '../src/index'
import type { Env } from '../src/types'

const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(FOLDER + name, 'utf8'))

type Loses = (sql: string) => boolean

type Bound = (sql: string, count: number) => void

type JustBefore = (sql: string) => void

function asD1(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? [...value] : value,
    ]),
  )
}

function d1(database: DatabaseSync, loses: Loses, bound: Bound, justBefore: JustBefore) {
  return {
    async batch(statements: { run(): Promise<unknown> }[]): Promise<unknown[]> {
      database.exec('begin')
      try {
        const answers: unknown[] = []
        for (const statement of statements) answers.push(await statement.run())
        database.exec('commit')
        return answers
      } catch (error) {
        database.exec('rollback')
        throw error
      }
    },

    prepare(sql: string) {
      const lost = loses(sql)
      justBefore(sql)

      const statement = {
        args: [] as never[],
        bind(...args: unknown[]) {
          statement.args = args as never[]
          bound(sql, args.length)
          return statement
        },
        first(): Promise<unknown> {
          return Promise.resolve(asD1(database.prepare(sql).get(...statement.args)) ?? null)
        },
        all(): Promise<{ results: unknown[] }> {
          return Promise.resolve({
            results: database
              .prepare(sql)
              .all(...statement.args)
              .map(asD1),
          })
        },
        run(): Promise<{ success: true; results: unknown[]; meta: { changes: number } }> {
          if (lost) return Promise.resolve({ success: true, results: [], meta: { changes: 0 } })

          const prepared = database.prepare(sql)
          if ((prepared as unknown as { columns(): unknown[] }).columns().length) {
            const changed = () =>
              (database.prepare('select total_changes() as n').get() as { n: number }).n
            const before = changed()
            const results = prepared.all(...statement.args).map(asD1)
            return Promise.resolve({
              success: true,
              results,
              meta: { changes: changed() - before },
            })
          }
          const result = prepared.run(...statement.args)
          return Promise.resolve({
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          })
        },
      }
      return statement
    },
  }
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new TextEncoder().encode(String(value))
}

function bucket() {
  const store = new Map<
    string,
    {
      value: unknown
      contentType: string | undefined
      customMetadata: Record<string, string> | undefined
    }
  >()
  const uploads = new Map<
    string,
    { key: string; parts: Map<number, Uint8Array>; options: unknown }
  >()
  let uploadsMade = 0

  return {
    keys: () => [...store.keys()],

    put(
      key: string,
      value: unknown,
      options?: {
        httpMetadata?: { contentType?: string }
        customMetadata?: Record<string, string>
      },
    ) {
      store.set(key, {
        value,
        contentType: options?.httpMetadata?.contentType,
        customMetadata: options?.customMetadata,
      })
      return Promise.resolve()
    },
    get(key: string) {
      const held = store.get(key)
      if (!held) return Promise.resolve(null)

      return Promise.resolve({
        size: bytesOf(held.value).length,
        text: () => Promise.resolve(new TextDecoder().decode(bytesOf(held.value))),
        arrayBuffer: () => Promise.resolve(bytesOf(held.value).slice().buffer),
        body: held.value,
        httpMetadata: { contentType: held.contentType },
        customMetadata: held.customMetadata,
      })
    },
    createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }) {
      const uploadId = `upload-${String(++uploadsMade)}`
      uploads.set(uploadId, { key, parts: new Map(), options })
      return Promise.resolve(this.resumeMultipartUpload(key, uploadId))
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      const put = (value: Uint8Array, options: unknown) =>
        this.put(key, value, options as { httpMetadata?: { contentType?: string } })
      return {
        key,
        uploadId,
        uploadPart(partNumber: number, value: ArrayBuffer | Uint8Array) {
          const upload = uploads.get(uploadId)
          if (!upload) {
            return Promise.reject(
              new Error('uploadPart: The specified multipart upload does not exist. (10024)'),
            )
          }
          upload.parts.set(partNumber, bytesOf(value))
          return Promise.resolve({ partNumber, etag: `etag-${String(partNumber)}` })
        },
        complete(parts: { partNumber: number; etag: string }[]) {
          const upload = uploads.get(uploadId)
          if (!upload) {
            return Promise.reject(
              new Error(
                'completeMultipartUpload: The specified multipart upload does not exist. (10024)',
              ),
            )
          }
          for (const { partNumber: number, etag } of parts) {
            if (!Number.isInteger(number) || number < 1 || number > 10_000) {
              return Promise.reject(
                new TypeError(`Part number must be between 1 and 10000 (inclusive).`),
              )
            }
            if (!upload.parts.has(number) || etag !== `etag-${String(number)}`) {
              return Promise.reject(
                new Error(
                  'completeMultipartUpload: One or more of the specified parts could not be found. (10025)',
                ),
              )
            }
          }
          const pieces = [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => upload.parts.get(part.partNumber) ?? new Uint8Array())
          const whole = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
          let at = 0
          for (const piece of pieces) {
            whole.set(piece, at)
            at += piece.length
          }
          uploads.delete(uploadId)
          return put(whole, upload.options).then(() => ({ key, size: whole.length }))
        },
        abort() {
          uploads.delete(uploadId)
          return Promise.resolve()
        },
      }
    },
    delete(keys: string | string[]) {
      for (const key of typeof keys === 'string' ? [keys] : keys) store.delete(key)
      return Promise.resolve()
    },
  }
}

export interface TestEnv extends Env {
  db: DatabaseSync
  losing(sql: RegExp): () => number
  justBefore(sql: RegExp, work: () => void): void
  keys(): string[]
  widest(): { count: number; sql: string }
  close(): void
}

export function testEnv(overrides: Partial<Env> = {}): TestEnv {
  const database = new DatabaseSync(':memory:')
  for (const migration of MIGRATIONS) database.exec(migration)

  let losing: RegExp | null = null
  let caught = 0

  const loses: Loses = (sql) => {
    if (!losing?.test(sql)) return false

    losing = null
    caught++
    return true
  }

  let widest = { count: 0, sql: '' }
  const bound: Bound = (sql, count) => {
    if (count > widest.count) widest = { count, sql }
  }

  const notes = bucket()

  let waiting: { sql: RegExp; work: () => void } | null = null
  const justBefore: JustBefore = (sql) => {
    if (!waiting?.sql.test(sql)) return

    const { work } = waiting
    waiting = null
    work()
  }

  return {
    DB: d1(database, loses, bound, justBefore) as unknown as D1Database,
    NOTES: notes as unknown as R2Bucket,
    BLOG_ROOT: 'orden.so',
    OTHER_BLOG_ROOTS: 'nibeditor.com',
    BLOG_CNAME_TARGET: 'cname.orden.so',
    APP_ORIGIN: 'https://orden.so',
    OTHER_ORIGINS: 'https://nibeditor.com',
    PASS_ORIGIN: 'https://pass.orden.so',
    MACHINE_DOMAIN: 'nibeditor.com',
    ...overrides,
    db: database,
    losing: (sql) => {
      losing = sql
      const before = caught
      return () => caught - before
    },
    justBefore: (sql, work) => {
      waiting = { sql, work }
    },
    keys: () => notes.keys(),
    widest: () => widest,
    close: () => database.close(),
  }
}

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
