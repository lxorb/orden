import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import type { Env } from '../src/types'

const FOLDER = fileURLToPath(new URL('../../../migrations/', import.meta.url))
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
