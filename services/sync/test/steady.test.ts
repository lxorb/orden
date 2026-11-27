import { afterEach, describe, expect, test } from 'vitest'
import { steadyDb, steadyEnv } from '../src/sync-server/src/steady'
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
                busy-- > 0 ? Promise.reject(new Error('D1_ERROR: database is locked: SQLITE_BUSY')) : bound.all(),
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
    await expect(writing.db.prepare('update notes set seq = 1').bind().run()).rejects.toThrow('Network connection lost')
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
describe('the bucket notes and files are kept in', () => {
  let eu: TestEnv | null = null
  afterEach(() => {
    eu?.close()
    eu = null
  })
  async function written(home: string | undefined): Promise<{ old: string[]; moved: string[]; read: number }> {
    eu = testEnv()
    env = testEnv({ NOTES_EU: eu.NOTES, ...(home === undefined ? {} : { NOTES_HOME: home }) })
    const token = await signIn(env, 'moving@example.com')
    const before = { old: env.keys().length, moved: eu.keys().length }
    const space = (await call(env, '/v1/spaces', { token, body: { name: 'Moved' } })).json.space.id
    const made = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'kept.md', content: 'kept\n' } })
    const read = await call(env, `/v1/notes/${made.json.note.id}`, { token })
    return {
      old: env.keys().slice(before.old),
      moved: eu.keys().slice(before.moved),
      read: read.status,
    }
  }
  test.each([undefined, 'enam', 'EU', ''])('is the first one while NOTES_HOME says %s', async (home) => {
    const { old, moved, read } = await written(home)
    expect(old.length).toBeGreaterThan(0)
    expect(moved).toEqual([])
    expect(read).toBe(200)
  })
  test('is the EU one once NOTES_HOME says eu, for every write and read, and the first is left alone', async () => {
    const { old, moved, read } = await written('eu')
    expect(moved.length).toBeGreaterThan(0)
    expect(old).toEqual([])
    expect(read).toBe(200)
  })
  test('is refused aloud when NOTES_HOME says eu and no EU bucket is bound, rather than written to the old one', () => {
    env = testEnv({ NOTES_HOME: 'eu' })
    const held = steadyEnv(env)
    expect(() => held.NOTES).toThrow('no NOTES_EU bucket is bound')
    expect(held.DB).toBeDefined()
  })
  test('every Durable Object and the nightly job read their bucket the same way', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const root = fileURLToPath(new URL('../src/', import.meta.url))
    const under = (folder: string): string[] =>
      readdirSync(root + folder).flatMap((name) =>
        statSync(root + folder + name).isDirectory() ? under(`${folder}${name}/`) : [folder + name],
      )
    const files = under('').filter((name) => name.endsWith('.ts') && !name.includes('/test/'))
    const objects = files.filter((name) => /implements DurableObject\b/.test(readFileSync(root + name, 'utf8')))
    expect(objects.length).toBeGreaterThanOrEqual(5)
    const bare = objects.filter((name) => !readFileSync(root + name, 'utf8').includes('this.env = steadyEnv(env)'))
    expect(bare).toEqual([])
    const index = readFileSync(`${root}index.ts`, 'utf8')
    expect(index).toContain('const env = steadyEnv(given)')
    expect(index).toContain('app.fetch(request, steadyEnv(env), context)')
  })
})
