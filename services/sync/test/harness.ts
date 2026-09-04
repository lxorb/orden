import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import app from '../src/index'
import type { Env } from '../src/types'

// Read rather than listed: a migration that exists but was never added here
// would leave every test running against yesterday's schema.
const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => FOLDER + name)

/** D1's shape over Node's built-in SQLite, so routes run against real SQL. */
function d1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args
          return statement
        },
        async first<T>() {
          return (database.prepare(sql).get(...(statement.args as never[])) as T) ?? null
        },
        async all<T>() {
          return { results: database.prepare(sql).all(...(statement.args as never[])) as T[] }
        },
        async run() {
          database.prepare(sql).run(...(statement.args as never[]))
          return { success: true }
        },
      }
      return statement
    },
  }
}

function bucket() {
  // Notes go in as text and images as bytes, so both are kept as given and
  // handed back the way the Worker asks for them.
  const store = new Map<string, { value: unknown; httpMetadata?: { contentType?: string } }>()

  return {
    async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { value, httpMetadata: options?.httpMetadata })
    },
    async get(key: string) {
      const held = store.get(key)
      if (!held) return null

      return {
        text: async () => String(held.value),
        body: held.value,
        httpMetadata: held.httpMetadata,
      }
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

export interface TestEnv extends Env {
  /** The database underneath, for setting up a state no endpoint can reach -
   *  an account already at its quota, for instance. */
  db: DatabaseSync
  close(): void
}

export function testEnv(overrides: Partial<Env> = {}): TestEnv {
  const database = new DatabaseSync(':memory:')
  for (const migration of MIGRATIONS) database.exec(readFileSync(migration, 'utf8'))

  return {
    DB: d1(database) as unknown as D1Database,
    NOTES: bucket() as unknown as R2Bucket,
    BLOG_ROOT: 'nibeditor.com',
    BLOG_CNAME_TARGET: 'cname.nibeditor.com',
    APP_ORIGIN: 'https://nibeditor.com',
    ...overrides,
    db: database,
    close: () => database.close(),
  }
}

interface CallOptions {
  method?: string
  body?: unknown
  /** Sent as-is instead of JSON, for uploads that are not JSON. */
  raw?: BodyInit
  headers?: Record<string, string>
  token?: string
  host?: string
}

/** Calls the Worker the way the network would. */
export async function call(env: Env, path: string, options: CallOptions = {}) {
  const host = options.host ?? 'nibeditor.com'
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  Object.assign(headers, options.headers ?? {})

  const method =
    options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST')

  const response = await app.fetch(
    new Request(`https://${host}${path}`, {
      method,
      headers,
      body:
        options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    }),
    env,
  )

  const text = await response.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // Blog responses are HTML.
  }

  return { status: response.status, json, text, headers: response.headers }
}

/** Runs the sign-in flow and returns a usable session token. */
export async function signIn(env: Env, email: string): Promise<string> {
  const logged: string[] = []
  const original = console.log
  console.log = (message: string) => logged.push(String(message))

  try {
    await call(env, '/v1/auth/code', { body: { email } })
  } finally {
    console.log = original
  }

  const code = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!code) throw new Error(`no code was sent:\n${logged.join('\n')}`)

  const verified = await call(env, '/v1/auth/verify', {
    body: { email, code: code[1] + code[2] },
  })

  if (verified.status !== 200) throw new Error(`sign-in failed: ${verified.text}`)
  return verified.json.token as string
}
