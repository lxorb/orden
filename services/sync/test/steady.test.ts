import { afterEach, describe, expect, test } from 'vitest'
import { steadyDb } from '../src/sync-server/src/steady'
import { call, signIn, type TestEnv, testEnv } from './harness'

let env: TestEnv | null = null

afterEach(() => {
  env?.close()
  env = null
})

function failing(times: number, said: string) {
  const asked: string[] = []
  let left = times
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    all: () => {
      asked.push(`all ${sql}`)
      if (left-- > 0) return Promise.reject(new Error(said))
      return Promise.resolve({ results: [] })
    },
    run: () => {
      asked.push(`run ${sql}`)
      if (left-- > 0) return Promise.reject(new Error(said))
      return Promise.resolve({ meta: { changes: 1 } })
    },
  })
  const db = { prepare: statement } as unknown as D1Database
  return { db: steadyDb(db), asked }
}

describe('the database a request reads', () => {
  test('is asked again while it is busy, so a busy moment is no 500', async () => {
    env = testEnv()
    const token = await signIn(env, 'busy@example.com')
    const space = (await call(env, '/v1/spaces', { token, body: { name: 'Busy' } })).json.space.id
    const inner = env.DB
    let busy = 2
    env.DB = {
      batch: (statements: D1PreparedStatement[]) => inner.batch(statements),
      prepare: (sql: string) => {
        const made = inner.prepare(sql)
        if (!sql.includes('from notes where space_id = ? and seq > ?')) return made
        return {
          bind: (...values: unknown[]) => {
            const bound = made.bind(...values)
            return {
              all: () =>
                busy-- > 0
                  ? Promise.reject(new Error('D1_ERROR: database is locked: SQLITE_BUSY'))
                  : bound.all(),
            }
          },
        }
      },
    } as unknown as D1Database

    const changes = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(changes.status).toBe(200)
    expect(busy).toBe(-1)
  })

  test('asks a read again when the connection dropped, a write only when it never ran', async () => {
    const reading = failing(2, 'D1_ERROR: Network connection lost.')
    await reading.db.prepare('select 1').bind().all()
    expect(reading.asked).toHaveLength(3)

    const writing = failing(1, 'D1_ERROR: Network connection lost.')
    await expect(writing.db.prepare('update notes set seq = 1').bind().run()).rejects.toThrow(
      'Network connection lost',
    )
    expect(writing.asked).toHaveLength(1)

    const locked = failing(1, 'database is locked: SQLITE_BUSY')
    await locked.db.prepare('update notes set seq = 1').bind().run()
    expect(locked.asked).toHaveLength(2)
  })

  test('gives up after a few tries and says what failed', async () => {
    const stuck = failing(10, 'D1_ERROR: database is locked: SQLITE_BUSY')
    await expect(stuck.db.prepare('select 1').all()).rejects.toThrow('SQLITE_BUSY')
    expect(stuck.asked).toHaveLength(4)
  })
})
