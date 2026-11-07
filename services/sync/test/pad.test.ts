import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { TEXT } from '@orden/rooms'
import { MOST_PAD_BYTES, padTradeOf, padWire } from '@orden/sync-core/pad'
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

async function trade(doc: Y.Doc, since: Uint8Array = new Uint8Array([0]), as = token) {
  const answer = await call(env, '/v2/pad', {
    token: as,
    body: padWire({ sv: Y.encodeStateVector(doc), update: Y.encodeStateAsUpdateV2(doc, since) }),
  })
  const got = padTradeOf(answer.json)
  if (got) Y.applyUpdateV2(doc, got.update)
  return { status: answer.status, sv: got?.sv ?? new Uint8Array([0]) }
}

const words = (doc: Y.Doc) => doc.getText(TEXT).toJSON()

const rows = (user = 'a@b.dev') =>
  env.db
    .prepare(
      'select count(*) as many from pad_updates where user_id = (select id from users where email = ?)',
    )
    .get(user) as { many: number }

describe('the scratchpad an account keeps', () => {
  test('starts as nothing', async () => {
    const doc = new Y.Doc()
    expect((await trade(doc)).status).toBe(200)
    expect(words(doc)).toBe('')
  })

  test('is the account’s own and nobody else’s', async () => {
    const mine = new Y.Doc()
    mine.getText(TEXT).insert(0, 'mine alone')
    await trade(mine)

    const theirs = new Y.Doc()
    await trade(theirs, undefined, other)
    expect(words(theirs)).toBe('')

    const again = new Y.Doc()
    await trade(again)
    expect(words(again)).toBe('mine alone')
  })

  test('keeps the words two devices wrote at once, each in its place', async () => {
    const first = new Y.Doc()
    first.getText(TEXT).insert(0, 'milk eggs')
    const { sv } = await trade(first)

    const second = new Y.Doc()
    await trade(second)
    expect(words(second)).toBe('milk eggs')

    first.getText(TEXT).insert(4, ' bread')
    second.getText(TEXT).insert(9, ' butter')
    second.getText(TEXT).insert(0, 'oat ')

    await trade(first, sv)
    await trade(second, sv)
    await trade(first, sv)
    expect(words(first)).toBe('oat milk bread eggs butter')
    expect(words(second)).toBe(words(first))
  })

  test('keeps a change sent twice once', async () => {
    const doc = new Y.Doc()
    doc.getText(TEXT).insert(0, 'once')
    await trade(doc)
    await trade(doc)
    await trade(doc)
    expect(rows().many).toBe(1)

    const fresh = new Y.Doc()
    await trade(fresh)
    expect(words(fresh)).toBe('once')
  })

  test('folds a long history into one and loses nothing', async () => {
    const doc = new Y.Doc()
    let sv: Uint8Array = new Uint8Array([0])
    for (let at = 0; at < 40; at++) {
      doc.getText(TEXT).insert(doc.getText(TEXT).length, `${at} `)
      sv = (await trade(doc, sv)).sv
    }
    expect(rows().many).toBeLessThanOrEqual(16)

    const fresh = new Y.Doc()
    await trade(fresh)
    expect(words(fresh)).toBe(Array.from({ length: 40 }, (_, at) => `${at} `).join(''))
  })

  test('answers only what a device lacks', async () => {
    const doc = new Y.Doc()
    doc.getText(TEXT).insert(0, 'all of it')
    await trade(doc)

    const answer = await call(env, '/v2/pad', {
      token,
      body: padWire({ sv: Y.encodeStateVector(doc), update: new Uint8Array() }),
    })
    const got = padTradeOf(answer.json)
    const empty = new Y.Doc()
    if (got) Y.applyUpdateV2(empty, got.update)
    expect(words(empty)).toBe('')
  })

  test('refuses what is not a change', async () => {
    const bad = await call(env, '/v2/pad', { token, body: { sv: 'AA==', update: 'not base64!' } })
    expect(bad.status).toBe(400)
    const garbage = await call(env, '/v2/pad', { token, body: { sv: 'AA==', update: 'AQID' } })
    expect(garbage.status).toBe(400)
    expect((await call(env, '/v2/pad', { token, body: [] })).status).toBe(400)
    expect(rows().many).toBe(0)
  })

  test('refuses a scratchpad larger than an account keeps', async () => {
    const doc = new Y.Doc()
    doc.getText(TEXT).insert(0, 'x'.repeat(MOST_PAD_BYTES + 10))
    expect((await trade(doc)).status).toBe(413)
    expect(rows().many).toBe(0)
  })

  test('needs a signed-in account', async () => {
    const answer = await call(env, '/v2/pad', { body: { sv: 'AA==' } })
    expect(answer.status).toBe(401)
  })
})
