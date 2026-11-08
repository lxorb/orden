import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MOST_TIME_ENTRIES, TIME_PAGE, type TimePage } from '@orden/sync-core/time'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let other: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  other = await signIn(env, 'c@d.dev')
})

afterEach(() => env.close())

const read = (since = 0, as = token) =>
  call<TimePage>(env, `/v2/time?since=${since}`, { token: as })

const write = (changes: unknown[], as = token) =>
  call<{ cursor: number; error?: string }>(env, '/v2/time', { token: as, body: { changes } })

const span = (id: string, start = 1) => ({ kind: 'span', id, value: { start, end: start + 60 } })

describe('the time an account keeps', () => {
  test('starts as nothing', async () => {
    expect((await read()).json).toEqual({ entries: [], cursor: 0, more: false })
  })

  test('is the account’s own and nobody else’s', async () => {
    expect((await write([span('a')])).status).toBe(200)
    expect((await read()).json.entries.map((one) => one.id)).toEqual(['a'])
    expect((await read(0, other)).json.entries).toEqual([])
  })

  test('comes back from a cursor on, the latest write of each record once', async () => {
    const first = (await write([span('a'), span('b')])).json.cursor
    expect(first).toBe(2)
    await write([span('a', 5)])

    const since = (await read(first)).json
    expect(since.entries.map((one) => [one.id, one.value?.start, one.seq])).toEqual([['a', 5, 3]])
    expect(since.cursor).toBe(3)
    expect((await read()).json.entries.map((one) => one.id)).toEqual(['b', 'a'])
  })

  test('keeps a record taken away as a tombstone', async () => {
    await write([span('a')])
    await write([{ kind: 'span', id: 'a', value: null }])
    expect((await read()).json.entries).toEqual([
      expect.objectContaining({ kind: 'span', id: 'a', value: null, seq: 2 }),
    ])
  })

  test('pages a long history', async () => {
    for (let page = 0; page <= TIME_PAGE / 200; page += 1) {
      await write(Array.from({ length: 200 }, (_, index) => span(`p${page}-${index}`)))
    }
    const first = (await read()).json
    expect(first.entries).toHaveLength(TIME_PAGE)
    expect(first.more).toBe(true)
    const rest = (await read(first.cursor)).json
    expect(rest.entries).toHaveLength(200)
    expect(rest.more).toBe(false)
  })

  test('refuses what is not a time record', async () => {
    expect((await write([{ kind: 'Span', id: 'a', value: {} }])).status).toBe(400)
    expect((await write([{ kind: 'span', id: 'a', value: 'words' }])).status).toBe(400)
    expect((await call(env, '/v2/time', { token, body: { nothing: true } })).status).toBe(400)
    expect((await read()).json.entries).toEqual([])
  })

  test('refuses more records than an account keeps, but not a change to one it has', async () => {
    const user = env.db.prepare(`select id from users where email = 'a@b.dev'`).get() as {
      id: string
    }
    env.db
      .prepare(
        `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
         insert into time_entries (user_id, kind, id, value, seq, at)
         select ?, 'span', 'x' || i, '{}', i, 1 from n`,
      )
      .run(MOST_TIME_ENTRIES, user.id)

    expect((await write([span('fresh')])).status).toBe(413)
    expect((await write([span('x7', 9)])).status).toBe(200)
  })

  test('lets no record past what it keeps when another arrives at the same moment', async () => {
    const user = env.db.prepare(`select id from users where email = 'a@b.dev'`).get() as {
      id: string
    }
    env.db
      .prepare(
        `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
         insert into time_entries (user_id, kind, id, value, seq, at)
         select ?, 'span', 'x' || i, '{}', i, 1 from n`,
      )
      .run(MOST_TIME_ENTRIES - 1, user.id)
    env.justBefore(/insert into time_cursor/, () => {
      env.db
        .prepare(
          `insert into time_entries (user_id, kind, id, value, seq, at)
           values (?, 'span', 'quicker', '{}', 0, 1)`,
        )
        .run(user.id)
    })

    expect((await write([span('fresh'), span('fresh', 2)])).status).toBe(413)
    expect(
      env.db.prepare('select count(*) as n from time_entries where user_id = ?').get(user.id),
    ).toEqual({ n: MOST_TIME_ENTRIES })
  })

  test('counts a record sent twice in one request once', async () => {
    const user = env.db.prepare(`select id from users where email = 'a@b.dev'`).get() as {
      id: string
    }
    env.db
      .prepare(
        `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
         insert into time_entries (user_id, kind, id, value, seq, at)
         select ?, 'span', 'x' || i, '{}', i, 1 from n`,
      )
      .run(MOST_TIME_ENTRIES - 1, user.id)

    expect((await write([span('fresh'), span('fresh', 2)])).status).toBe(200)
  })

  test('asks to be signed in', async () => {
    expect((await call(env, '/v2/time')).status).toBe(401)
  })
})
