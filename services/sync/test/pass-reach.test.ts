import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { eraseAccount } from '../src/erase'
import { guestMayReach } from '../src/guests'
import { sweepPassLinks } from '../src/pass'
import { programMayReach } from '../src/programs'
import { call, type TestEnv, testEnv } from './harness'
import { connect, hubs } from './hub-fakes'
import {
  aKeyring,
  anId,
  pass,
  passCall,
  type Person,
  person,
  sealed,
  sharedVault,
} from './pass-fakes'

let env: TestEnv
let ada: Person
let bob: Person
let api: ReturnType<typeof pass>

beforeEach(async () => {
  env = testEnv()
  ada = await person(env, 'ada@example.com')
  bob = await person(env, 'bob@example.com')
  api = pass(env)
})

afterEach(() => env.close())

const PATHS: readonly (readonly [string, string])[] = [
  ['GET', '/v2/pass/changes'],
  ['PUT', '/v2/pass/keyring'],
  ['GET', '/v2/pass/people/key'],
  ['PUT', '/v2/pass/vaults/abcdefgh'],
  ['DELETE', '/v2/pass/vaults/abcdefgh'],
  ['GET', '/v2/pass/vaults/abcdefgh/items'],
  ['PUT', '/v2/pass/items/abcdefgh/abcdefgh'],
  ['GET', '/v2/pass/items/abcdefgh/abcdefgh/versions'],
  ['POST', '/v2/pass/items/abcdefgh/abcdefgh/move'],
  ['POST', '/v2/pass/vaults/abcdefgh/invites'],
  ['POST', '/v2/pass/invites/abcdefgh/accept'],
  ['POST', '/v2/pass/vaults/abcdefgh/rotate'],
  ['POST', '/v2/pass/links'],
  ['GET', '/v2/pass/links'],
]

describe('the Pass routes', () => {
  test('are nothing a guest or a program reaches', () => {
    for (const [method, path] of PATHS) {
      expect(guestMayReach(method, path), path).toBe(false)
      expect(programMayReach(method, path, false), path).toBe(false)
      expect(programMayReach(method, path, true), path).toBe(false)
    }
  })

  test('refuse a program’s token', async () => {
    const minted = await call<{ token?: string }>(env, '/v1/mcp/token', {
      token: ada.token,
      body: { readOnly: false },
    })
    const program = { ...ada, token: minted.json.token ?? '' }
    expect((await passCall(env, program, 'GET', '/changes')).status).toBe(403)
    expect((await api.keyring(program)).status).toBe(403)
    expect((await api.vault(program, anId())).status).toBe(403)
  })

  test('refuse a guest', async () => {
    const space = (await call(env, '/v1/spaces', { token: ada.token, body: { name: 'Plans' } }))
      .json.space as { id: string }
    const shared = await call<{ link?: { url: string } }>(
      env,
      `/v1/spaces/${space.id}/share/link`,
      { method: 'PUT', token: ada.token, body: { role: 'write', mode: 'open' } },
    )
    const link = /\/join\/([a-f0-9]+)/.exec(shared.json.link?.url ?? '')?.[1] ?? ''
    const joined = await call<{ token: string }>(env, `/v1/join/${link}`, {
      method: 'POST',
      body: {},
    })
    const guest = { ...ada, token: joined.json.token }
    expect(guest.token).not.toBe('')
    expect((await passCall(env, guest, 'GET', '/changes')).status).toBe(403)
    expect((await api.vault(guest, anId())).status).toBe(403)
  })

  test('refuse anybody not signed in, except a secure link', async () => {
    expect((await call(env, '/v2/pass/changes')).status).toBe(401)
    expect((await call(env, `/v1/pass-link/${anId()}`)).status).toBe(404)
  })
})

describe('the hub', () => {
  test('tells the writer’s other devices and every member, and not the device that wrote', async () => {
    const running = hubs(env)
    env.HUB = running.HUB
    const vault = await sharedVault(env, ada, bob)
    const here = connect(running.of(ada.id).hub, { device: 'device-here', who: ada.id })
    const there = connect(running.of(ada.id).hub, { device: 'device-there', who: ada.id })
    const bobs = connect(running.of(bob.id).hub, { device: 'device-bobs', who: bob.id })

    await call(env, `/v2/pass/items/${vault}/${anId()}?from=device-here`, {
      method: 'PUT',
      token: ada.token,
      body: { rev: 0, key: sealed(), body: sealed(), keyVersion: 1 },
    })

    expect(here.said).toEqual([])
    expect(there.said).toEqual([{ t: 'pass' }])
    expect(bobs.said).toEqual([{ t: 'pass' }])
  })

  test('is not told of a vault somebody else is in alone', async () => {
    const running = hubs(env)
    env.HUB = running.HUB
    const vault = anId()
    await api.vault(ada, vault)
    running.asked.length = 0
    await api.item(ada, vault, anId())
    expect(running.asked.filter((one) => one.ask === 'pass').map((one) => one.id)).toEqual([ada.id])
  })
})

function rowsNaming(database: DatabaseSync, marks: readonly string[]): string[] {
  const tables = (
    database
      .prepare("select name from sqlite_master where type = 'table' and name like 'pass_%'")
      .all() as { name: string }[]
  ).map((one) => one.name)
  return tables.flatMap((table) =>
    database
      .prepare(`select * from ${table}`)
      .all()
      .map((row) => JSON.stringify(row))
      .filter((row) => marks.some((mark) => row.includes(mark)))
      .map((row) => `${table}: ${row}`),
  )
}

describe('deleting an account', () => {
  test('leaves no Pass row that names it, and its vaults gone for their members', async () => {
    await api.keyring(ada, 0, aKeyring())
    const owned = await sharedVault(env, ada, bob)
    await api.item(ada, owned, anId())
    const theirs = await sharedVault(env, bob, ada, 'manager')
    const kept = anId()
    await api.item(bob, theirs, kept)
    await api.invite(ada, theirs, 'third@example.com')
    await passCall(env, ada, 'POST', '/links', {
      id: anId(),
      vault: theirs,
      item: kept,
      body: sealed(),
      expires: Date.now() + 60_000,
      views: null,
    })
    const before = (await api.changes(bob)).seq

    await eraseAccount(env, { id: ada.id, email: ada.email, name: null, created_at: 1 })

    expect(rowsNaming(env.db, [ada.id, ada.email])).toEqual([])
    const after = await api.changes(bob, before)
    expect(after.vaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: owned, deleted: true }),
        expect.objectContaining({ id: theirs, deleted: false, members: 2 }),
      ]),
    )
    expect(
      env.db.prepare('select count(*) as n from pass_items where vault_id = ?').get(owned),
    ).toEqual({
      n: 0,
    })
    expect(
      env.db.prepare('select count(*) as n from pass_items where vault_id = ?').get(theirs),
    ).toEqual({
      n: 1,
    })
    expect(env.db.prepare('select count(*) as n from pass_links').get()).toEqual({ n: 0 })
  })

  test('leaves a nameless removed mark in the vaults it was in, so their managers renew the key', async () => {
    const theirs = await sharedVault(env, bob, ada, 'editor')
    await eraseAccount(env, { id: ada.id, email: ada.email, name: null, created_at: 1 })
    const rows = env.db
      .prepare(
        'select email, user_id, state, key, key_version from pass_members where vault_id = ?',
      )
      .all(theirs) as { email: string; user_id: string | null; state: string; key: string | null }[]
    expect(rows).toHaveLength(2)
    const gone = rows.find((one) => one.email !== bob.email)
    expect(gone).toMatchObject({ user_id: null, state: 'removed', key: null, key_version: 1 })
    expect(gone?.email).toMatch(/^erased-[0-9a-f]{24}$/)
    expect(rowsNaming(env.db, [ada.id, ada.email])).toEqual([])
  })

  test('takes a vault nobody else was in with it entirely', async () => {
    const alone = anId()
    await api.vault(ada, alone)
    await eraseAccount(env, { id: ada.id, email: ada.email, name: null, created_at: 1 })
    expect(env.db.prepare('select count(*) as n from pass_vaults').get()).toEqual({ n: 0 })
    expect(env.db.prepare('select count(*) as n from pass_members').get()).toEqual({ n: 0 })
  })
})

describe('the nightly sweep', () => {
  test('forgets what an expired link held', async () => {
    const vault = anId()
    const item = anId()
    await api.vault(ada, vault)
    await api.item(ada, vault, item)
    await passCall(env, ada, 'POST', '/links', {
      id: anId(),
      vault,
      item,
      body: sealed(),
      expires: Date.now() + 60_000,
      views: null,
    })
    await sweepPassLinks(env, Date.now())
    expect(env.db.prepare("select count(*) as n from pass_links where body <> ''").get()).toEqual({
      n: 1,
    })
    await sweepPassLinks(env, Date.now() + 120_000)
    expect(env.db.prepare("select count(*) as n from pass_links where body <> ''").get()).toEqual({
      n: 0,
    })
  })
})
