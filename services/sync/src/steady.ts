import type { Env } from './types'

const NOT_RUN = /SQLITE_BUSY|database is locked|D1 DB is overloaded/i

const PASSING =
  /Network connection lost|storage caused object to be reset|reset because its code was updated|D1_ERROR: internal error/i

const PAUSES = [20, 80, 300]

const READS = /^\s*(select|with|pragma)\b/i
const WRITES = /\b(insert|update|delete|replace|create|drop|alter)\b/i

const ANSWERS = new Set<PropertyKey>(['first', 'all', 'raw', 'run'])

const unwrapped = new WeakMap<object, D1PreparedStatement>()

function said(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.cause instanceof Error ? `${error.message} ${error.cause.message}` : error.message
}

function tryAgain(error: unknown, reads: boolean): boolean {
  const words = said(error)
  return NOT_RUN.test(words) || (reads && PASSING.test(words))
}

async function steadily<T>(work: () => Promise<T>, reads: boolean): Promise<T> {
  for (let at = 0; ; at += 1) {
    try {
      return await work()
    } catch (error) {
      const pause = PAUSES[at]
      if (pause === undefined || !tryAgain(error, reads)) throw error
      await new Promise((settle) => setTimeout(settle, pause * (1 + Math.random())))
    }
  }
}

function steadyStatement(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
  const reads = READS.test(sql) && !WRITES.test(sql)
  const held = new Proxy(statement, {
    get(target, key) {
      if (key === 'bind') {
        return (...values: unknown[]) => steadyStatement(target.bind(...values), sql)
      }
      const value: unknown = Reflect.get(target, key, target)
      if (!ANSWERS.has(key) || typeof value !== 'function') {
        return typeof value === 'function'
          ? (value as (...values: unknown[]) => unknown).bind(target)
          : value
      }
      const answer = value as (...values: unknown[]) => Promise<unknown>
      return (...values: unknown[]) => steadily(() => answer.apply(target, values), reads)
    },
  })
  unwrapped.set(held, statement)
  return held
}

export function steadyDb(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) => steadyStatement(target.prepare(sql), sql)
      }
      if (key === 'batch') {
        return (statements: D1PreparedStatement[]) =>
          steadily(() => target.batch(statements.map((one) => unwrapped.get(one) ?? one)), false)
      }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function'
        ? (value as (...values: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

export function steadyEnv(env: Env): Env {
  return { ...env, DB: steadyDb(env.DB) }
}
