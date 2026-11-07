import type { ItemRow, Version } from '@orden/pass/wire'
import { MOST_ITEM_BYTES, MOST_ITEMS, MOST_VAULTS, MOST_VERSIONS } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { QUOTA, usedBytes } from '../src/storage'
import { type TestEnv, testEnv } from './harness'
import { anId, pass, passCall, type Person, person, sealed } from './pass-fakes'

let env: TestEnv
let ada: Person
let api: ReturnType<typeof pass>
let vault: string

beforeEach(async () => {
  env = testEnv()
  ada = await person(env, 'ada@example.com')
  api = pass(env)
  vault = anId()
  await api.vault(ada, vault)
})

afterEach(() => env.close())

const fill = (table: string, rows: number, row: (at: number) => unknown[]) => {
  const marks = `(${row(0)
    .map(() => '?')
    .join(', ')})`
  const insert = env.db.prepare(`insert into ${table} values ${marks}`)
  env.db.exec('begin')
  for (let at = 0; at < rows; at++) insert.run(...(row(at) as never[]))
  env.db.exec('commit')
}

describe('a vault', () => {
  test('is made with its owner as a member and comes back in the changes', async () => {
    const changes = await api.changes(ada)
    expect(changes.vaults).toEqual([
      {
        id: vault,
        rev: 1,
        meta: expect.any(String),
        key: expect.any(String),
        keyVersion: 1,
        role: 'owner',
        owner: true,
        members: 1,
        deleted: false,
        proof: null,
        handovers: [],
        accepted: null,
      },
    ])
  })

  test('needs a key when it is made', async () => {
    const made = await api.vault(ada, anId(), 0, sealed(), null)
    expect(made.status).toBe(400)
  })

  test('takes a new name over the revision it was read at, and refuses an older one', async () => {
    const meta = sealed()
    expect((await api.vault(ada, vault, 1, meta)).json.rev).toBe(2)

    const stale = await api.vault(ada, vault, 1, sealed())
    expect(stale.status).toBe(409)
    expect(stale.json.error).toBe('stale')
    expect(stale.json.current).toMatchObject({ id: vault, rev: 2, meta })
  })

  test('is not made over somebody else’s id', async () => {
    const bob = await person(env, 'bob@example.com')
    const taken = await api.vault(bob, vault)
    expect(taken.status).toBe(409)
    expect(taken.json.error).toBe('that id is taken')
  })

  test(`is one of at most ${String(MOST_VAULTS)}`, async () => {
    for (let made = 1; made < MOST_VAULTS; made++) {
      expect((await api.vault(ada, anId())).status).toBe(200)
    }
    const one = await api.vault(ada, anId())
    expect(one.status).toBe(409)
    expect(one.json.error).toBe('that is as many vaults as one account holds')

    await passCall(env, ada, 'DELETE', `/vaults/${vault}`)
    expect((await api.vault(ada, anId())).status).toBe(200)
  })

  test('when deleted, takes its items with it and says so in the changes', async () => {
    const item = anId()
    await api.item(ada, vault, item)
    const before = (await api.changes(ada)).seq

    expect((await passCall(env, ada, 'DELETE', `/vaults/${vault}`)).status).toBe(200)

    const after = await api.changes(ada, before)
    expect(after.vaults).toEqual([
      expect.objectContaining({ id: vault, deleted: true, meta: '', key: null }),
    ])
    expect(after.items).toEqual([])
    expect(env.db.prepare('select count(*) as n from pass_items').get()).toEqual({ n: 0 })
    expect((await api.item(ada, vault, anId())).status).toBe(404)
  })

  test('refuses junk', async () => {
    for (const body of [
      {},
      { rev: 0, meta: 'not base64!', key: sealed() },
      { rev: -1, meta: sealed(), key: sealed() },
      { rev: 0, meta: 5, key: sealed() },
      { rev: 0, meta: sealed(), key: sealed(), keyVersion: 0 },
    ]) {
      expect((await passCall(env, ada, 'PUT', `/vaults/${anId()}`, body)).status).toBe(400)
    }
    expect(
      (await passCall(env, ada, 'PUT', '/vaults/short', { rev: 0, meta: sealed(), key: sealed() }))
        .status,
    ).toBe(400)
  })
})

describe('an item', () => {
  test('is made at revision 0 and changed over the revision it was read at', async () => {
    const item = anId()
    const made = await api.item(ada, vault, item)
    expect(made.json).toEqual({ rev: 1, at: expect.any(Number) })
    expect((await api.item(ada, vault, item, 1)).json.rev).toBe(2)

    const changes = await api.changes(ada)
    expect(changes.items).toEqual([
      expect.objectContaining({ vault, id: item, rev: 2, keyVersion: 1, deleted: false }),
    ])
  })

  test('refuses an older revision and hands back what is there', async () => {
    const item = anId()
    await api.item(ada, vault, item)
    await api.item(ada, vault, item, 1)

    const stale = await api.item(ada, vault, item, 1)
    expect(stale.status).toBe(409)
    expect(stale.json.error).toBe('stale')
    const current = stale.json.current as ItemRow
    expect(current).toMatchObject({ vault, id: item, rev: 2, deleted: false })

    const twice = await api.item(ada, vault, item, 0)
    expect(twice.status).toBe(409)
    expect((twice.json.current as ItemRow).rev).toBe(2)
  })

  test('is sealed under the vault’s key of now', async () => {
    const wrong = await api.item(ada, vault, anId(), 0, 2)
    expect(wrong.status).toBe(409)
    expect(wrong.json).toEqual({ error: 'the vault has a newer key', keyVersion: 1 })
  })

  test(`keeps its last ${String(MOST_VERSIONS)} versions, newest first`, async () => {
    const item = anId()
    await api.item(ada, vault, item)
    for (let rev = 1; rev <= MOST_VERSIONS + 5; rev++) await api.item(ada, vault, item, rev)

    const { json } = await passCall<{ versions: Version[] }>(
      env,
      ada,
      'GET',
      `/items/${vault}/${item}/versions`,
    )
    expect(json.versions).toHaveLength(MOST_VERSIONS)
    expect(json.versions[0]?.rev).toBe(MOST_VERSIONS + 5)
    expect(json.versions.at(-1)?.rev).toBe(6)
    expect(env.db.prepare('select count(*) as n from pass_versions').get()).toEqual({
      n: MOST_VERSIONS,
    })
  })

  test('deleted for good leaves a mark with nothing in it, and no versions', async () => {
    const item = anId()
    await api.item(ada, vault, item)
    await api.item(ada, vault, item, 1)

    expect((await passCall(env, ada, 'DELETE', `/items/${vault}/${item}?rev=1`)).status).toBe(409)
    expect((await passCall(env, ada, 'DELETE', `/items/${vault}/${item}?rev=2`)).json.rev).toBe(3)

    const [row] = (await api.changes(ada)).items
    expect(row).toEqual({
      vault,
      id: item,
      rev: 3,
      key: '',
      body: '',
      keyVersion: 1,
      at: expect.any(Number),
      deleted: true,
    })
    expect(env.db.prepare('select count(*) as n from pass_versions').get()).toEqual({ n: 0 })
    expect((await passCall(env, ada, 'GET', `/items/${vault}/${item}/versions`)).status).toBe(404)
  })

  test('moves to another vault in one step, sealed anew', async () => {
    const other = anId()
    await api.vault(ada, other)
    const item = anId()
    await api.item(ada, vault, item)
    await api.item(ada, vault, item, 1)
    const before = (await api.changes(ada)).seq

    const moved = await passCall(env, ada, 'POST', `/items/${vault}/${item}/move`, {
      to: other,
      rev: 2,
      key: sealed(),
      body: sealed(),
      keyVersion: 1,
    })
    expect(moved.status).toBe(200)
    expect(moved.json.rev).toBe(1)

    const after = await api.changes(ada, before)
    expect(after.items).toEqual([
      expect.objectContaining({ vault: other, id: item, rev: 1, deleted: false }),
      expect.objectContaining({ vault, id: item, rev: 3, deleted: true }),
    ])
    expect(env.db.prepare('select count(*) as n from pass_versions').get()).toEqual({ n: 0 })
  })

  test('does not move from an older revision, or onto an item that is there', async () => {
    const other = anId()
    await api.vault(ada, other)
    const item = anId()
    await api.item(ada, vault, item)
    await api.item(ada, other, item)

    const move = (rev: number) =>
      passCall(env, ada, 'POST', `/items/${vault}/${item}/move`, {
        to: other,
        rev,
        key: sealed(),
        body: sealed(),
        keyVersion: 1,
      })
    expect((await move(2)).json.error).toBe('stale')
    expect((await move(1)).json.error).toBe('that id is taken')
    expect((await api.changes(ada)).items.filter((one) => one.deleted)).toEqual([])
  })

  test(`is one of at most ${String(MOST_ITEMS)} in a vault`, async () => {
    fill('pass_items', MOST_ITEMS - 1, (at) => [
      vault,
      `item-${String(at).padStart(6, '0')}`,
      1,
      sealed(),
      sealed(),
      1,
      1,
      null,
      0,
    ])
    expect((await api.item(ada, vault, anId())).status).toBe(200)
    const one = await api.item(ada, vault, anId())
    expect(one.status).toBe(409)
    expect(one.json.error).toBe('that is as many items as one vault holds')
  })

  test(`is at most ${String(MOST_ITEM_BYTES)} characters sealed, and refuses junk`, async () => {
    const write = (body: unknown) => passCall(env, ada, 'PUT', `/items/${vault}/${anId()}`, body)
    const good = { rev: 0, key: sealed(), body: sealed(), keyVersion: 1 }
    expect((await write({ ...good, body: 'A'.repeat(MOST_ITEM_BYTES + 4) })).status).toBe(400)
    for (const bad of [
      { ...good, body: 'not base64' },
      { ...good, key: '' },
      { ...good, rev: -1 },
      { ...good, keyVersion: 'one' },
      { ...good, body: undefined },
    ]) {
      expect((await write(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await write(good)).status).toBe(200)
  })

  test('counts with its versions against the vault owner’s storage', async () => {
    const id = anId()
    const bob = await person(env, 'bob@example.com')
    const bobs = await usedBytes(env, bob.id)
    const before = await usedBytes(env, ada.id)
    expect((await api.item(ada, vault, id)).status).toBe(200)
    const one = 64 + 160
    expect(await usedBytes(env, ada.id)).toBe(before + one)
    expect((await api.item(ada, vault, id, 1)).status).toBe(200)
    expect(await usedBytes(env, ada.id)).toBe(before + 2 * one)
    expect(await usedBytes(env, bob.id)).toBe(bobs)

    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run('a1'.repeat(32), ada.id, QUOTA - before - 2 * one - one + 1, 'image/png', 1)
    const full = await api.item(ada, vault, anId())
    expect(full.status).toBe(507)
    expect(full.json.error).toBe('out of space')
  })

  test('is written at most 600 times a minute by one person', async () => {
    env.db
      .prepare(`insert into limits (scope, key, count, until) values ('pass-items', ?, 599, ?)`)
      .run(ada.id, Date.now() + 60_000)
    expect((await api.item(ada, vault, anId())).status).toBe(200)
    const many = await api.item(ada, vault, anId())
    expect(many.status).toBe(429)
    env.db.prepare(`update limits set until = ? where scope = 'pass-items'`).run(Date.now() - 1)
    expect((await api.item(ada, vault, anId())).status).toBe(200)
  })

  test('is refused in a vault one is not in', async () => {
    const bob = await person(env, 'bob@example.com')
    expect((await api.item(bob, vault, anId())).status).toBe(404)
    expect((await passCall(env, bob, 'GET', `/vaults/${vault}/items`)).status).toBe(404)
  })
})
