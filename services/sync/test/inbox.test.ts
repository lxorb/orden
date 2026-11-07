import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { inboxStamp, INBOX_PAGE, MOST_INBOX_ITEMS, type InboxPage } from '@orden/sync-core/inbox'
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
  call<InboxPage>(env, `/v2/inbox?since=${since}`, { token: as })

const write = (changes: unknown[], as = token) =>
  call<{ cursor: number; error?: string }>(env, '/v2/inbox', { token: as, body: { changes } })

const at = (time: number, device = 'one') => inboxStamp(time, 0, device)

const todo = (id: string, fields: Record<string, unknown>, time = 1, device = 'one') => ({
  id,
  fields,
  stamps: Object.fromEntries(Object.keys(fields).map((key) => [key, at(time, device)])),
})

const fieldsOf = async (as = token) =>
  Object.fromEntries((await read(0, as)).json.items.map((one) => [one.id, one.fields]))

describe('the inbox an account keeps', () => {
  test('starts empty and is the account’s own', async () => {
    expect((await read()).json).toEqual({ items: [], cursor: 0, more: false })
    expect((await write([todo('a', { text: 'Call the bank', status: ' ' })])).status).toBe(200)
    expect(await fieldsOf()).toEqual({ a: { text: 'Call the bank', status: ' ' } })
    expect((await read(0, other)).json.items).toEqual([])
  })

  test('merges a to-do field by field, the later change of each field winning', async () => {
    await write([todo('a', { text: 'Call the bank', status: ' ', due: '2026-11-07' }, 1)])
    await write([todo('a', { text: 'Call the bank today' }, 5, 'phone')])
    await write([todo('a', { status: 'x', text: 'stale words' }, 3, 'laptop')])
    expect(await fieldsOf()).toEqual({
      a: { text: 'Call the bank today', status: 'x', due: '2026-11-07' },
    })
  })

  test('keeps a field set to nothing, and its stamp, so an older value does not come back', async () => {
    await write([todo('a', { text: 'Pay', due: '2026-11-07' }, 1)])
    await write([todo('a', { due: null }, 4)])
    await write([todo('a', { due: '2026-12-01' }, 2)])
    expect(await fieldsOf()).toEqual({ a: { text: 'Pay', due: null } })
  })

  test('comes back from a cursor on, and a change that changes nothing moves no cursor', async () => {
    const first = (await write([todo('a', { text: 'A' }), todo('b', { text: 'B' })])).json.cursor
    expect(first).toBe(2)
    await write([todo('a', { text: 'A' })])
    expect((await read(first)).json.items).toEqual([])
    await write([todo('a', { text: 'AA' }, 2)])
    expect((await read(first)).json.items.map((one) => [one.id, one.fields.text])).toEqual([
      ['a', 'AA'],
    ])
  })

  test('takes two changes to one to-do in one request together', async () => {
    await write([todo('a', { text: 'A' }, 1), todo('a', { due: '2026-11-08' }, 2)])
    expect(await fieldsOf()).toEqual({ a: { text: 'A', due: '2026-11-08' } })
  })

  test('pages a long inbox', async () => {
    for (let page = 0; page <= INBOX_PAGE / 200; page += 1) {
      await write(
        Array.from({ length: 200 }, (_, index) => todo(`p${page}-${index}`, { text: 'x' })),
      )
    }
    const first = (await read()).json
    expect(first.items).toHaveLength(INBOX_PAGE)
    expect(first.more).toBe(true)
    expect((await read(first.cursor)).json.items).toHaveLength(200)
  })

  test('refuses what is not a change to a to-do', async () => {
    expect((await write([{ id: 'a', fields: { text: 'x' }, stamps: {} }])).status).toBe(400)
    expect((await write([{ id: 'a', fields: { text: {} }, stamps: { text: at(1) } }])).status).toBe(
      400,
    )
    expect(
      (await write([{ id: 'a b', fields: { text: 'x' }, stamps: { text: at(1) } }])).status,
    ).toBe(400)
    expect(
      (await write([{ id: 'a', fields: { text: 'x' }, stamps: { text: 'soon' } }])).status,
    ).toBe(400)
    expect((await read()).json.items).toEqual([])
  })

  test('refuses more to-dos than an inbox keeps, but not a change to one it has', async () => {
    const user = env.db.prepare(`select id from users where email = 'a@b.dev'`).get() as {
      id: string
    }
    env.db
      .prepare(
        `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
         insert into inbox_items (user_id, id, fields, stamps, seq, at)
         select ?, 'x' || i, '{}', '{}', i, 1 from n`,
      )
      .run(MOST_INBOX_ITEMS, user.id)
    expect((await write([todo('fresh', { text: 'x' })])).status).toBe(413)
    expect((await write([todo('x7', { text: 'x' })])).status).toBe(200)
  })

  test('asks to be signed in', async () => {
    expect((await call(env, '/v2/inbox')).status).toBe(401)
  })
})
