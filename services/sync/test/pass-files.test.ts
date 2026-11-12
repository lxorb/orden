import { MOST_FILE_PARTS, MOST_SEALED_PART } from '@orden/pass/file-sizes'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sweepLeftovers } from '../src/sync-server/src/leftovers'
import { QUOTA, usedBytes } from '../src/sync-server/src/storage'
import { call, type TestEnv, testEnv } from './harness'
import { anId, pass, passCall, type Person, person, sharedVault } from './pass-fakes'

let env: TestEnv
let ada: Person
let api: ReturnType<typeof pass>
let vault: string
let item: string

beforeEach(async () => {
  env = testEnv()
  ada = await person(env, 'ada@example.com')
  api = pass(env)
  vault = anId()
  item = anId()
  await api.vault(ada, vault)
  await api.item(ada, vault, item)
})

afterEach(() => env.close())

interface Listed {
  files: { id: string; parts: number; size: number; complete: boolean }[]
  error?: string
}

function lengthOf(raw: BodyInit): number {
  if (typeof raw === 'string') return new TextEncoder().encode(raw).length
  return raw instanceof Uint8Array ? raw.byteLength : 0
}

function put(who: Person, at: string, raw: BodyInit, query = '') {
  return call<{ stored?: boolean; size?: number; error?: string }>(
    env,
    `/v2/pass/files/${at}${query}`,
    {
      method: 'PUT',
      raw,
      token: who.token,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(lengthOf(raw)),
      },
    },
  )
}

function get(who: Person, at: string, query = '') {
  return call(env, `/v2/pass/files/${at}${query}`, { token: who.token })
}

const objects = () => env.keys().filter((key) => key.startsWith('pass/files/'))

describe('a file in an item', () => {
  test('is kept in parts and read back by its members', async () => {
    const file = anId()
    const at = `${vault}/${item}/${file}`
    expect((await put(ada, at, 'part zero', '?part=0&parts=2')).status).toBe(201)
    expect((await put(ada, at, 'part one', '?part=1&parts=2')).json).toEqual({
      stored: true,
      size: 8,
    })
    expect((await get(ada, at, '?part=0')).text).toBe('part zero')
    expect((await get(ada, at, '?part=1')).text).toBe('part one')
    expect((await get(ada, at)).text).toBe('part zero')
    expect((await get(ada, at, '?part=2')).status).toBe(404)
    const listed = await passCall<Listed>(env, ada, 'GET', `/files/${vault}/${item}`)
    expect(listed.json.files).toEqual([{ id: file, parts: 2, size: 17, complete: true }])
    expect(objects()).toHaveLength(2)
  })

  test('is listed as not complete until every part is there', async () => {
    const file = anId()
    await put(ada, `${vault}/${item}/${file}`, 'one', '?part=0&parts=3')
    const listed = await passCall<Listed>(env, ada, 'GET', `/files/${vault}/${item}`)
    expect(listed.json.files).toEqual([{ id: file, parts: 3, size: 3, complete: false }])
  })

  test('is written by editors and read by viewers, and nobody else', async () => {
    const bob = await person(env, 'bob@example.com')
    const eve = await person(env, 'eve@example.com')
    const shared = await sharedVault(env, ada, bob, 'viewer')
    const there = anId()
    await api.item(ada, shared, there)
    const at = `${shared}/${there}/${anId()}`
    expect((await put(ada, at, 'secret')).status).toBe(201)
    expect((await get(bob, at)).text).toBe('secret')
    expect((await put(bob, at, 'mine')).status).toBe(403)
    expect((await passCall(env, bob, 'DELETE', `/files/${at}`)).status).toBe(403)
    expect((await get(eve, at)).status).toBe(404)
    expect((await put(eve, at, 'mine')).status).toBe(404)
  })

  test('refuses a part too big, out of range, or too many parts', async () => {
    const at = `${vault}/${item}/${anId()}`
    expect((await put(ada, at, new Uint8Array(MOST_SEALED_PART + 1))).status).toBe(413)
    expect((await put(ada, at, 'x', '?part=2&parts=2')).status).toBe(400)
    expect((await put(ada, at, 'x', `?parts=${String(MOST_FILE_PARTS + 1)}`)).status).toBe(400)
    expect((await put(ada, at, 'x', '?part=-1')).status).toBe(400)
    expect((await put(ada, at, '')).status).toBe(400)
    expect((await put(ada, `${vault}/${anId()}/${anId()}`, 'x')).status).toBe(404)
    expect((await put(ada, at, new Uint8Array(MOST_SEALED_PART))).status).toBe(201)
  })

  test('keeps its count of parts', async () => {
    const at = `${vault}/${item}/${anId()}`
    await put(ada, at, 'a', '?part=0&parts=2')
    expect((await put(ada, at, 'b', '?part=1&parts=3')).status).toBe(409)
  })

  test('counts against the account’s storage', async () => {
    const used = await usedBytes(env, ada.id)
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run('a1'.repeat(32), ada.id, QUOTA - used - 4, 'image/png', 1)
    const at = `${vault}/${item}/${anId()}`
    expect((await put(ada, at, 'four')).status).toBe(201)
    expect((await put(ada, at, 'four')).status).toBe(201)
    const full = await put(ada, `${vault}/${item}/${anId()}`, 'x')
    expect(full.status).toBe(507)
    expect(full.json.error).toBe('out of space')
    expect(await usedBytes(env, ada.id)).toBe(QUOTA)
  })

  test('is not taken over from another vault under the same ids', async () => {
    const file = anId()
    await put(ada, `${vault}/${item}/${file}`, 'first')
    const other = anId()
    await api.vault(ada, other)
    await api.item(ada, other, item)
    const taken = await put(ada, `${other}/${item}/${file}`, 'second')
    expect(taken.status).toBe(409)
    expect(taken.json.error).toBe('that id is taken')
    expect((await get(ada, `${other}/${item}/${file}`)).status).toBe(404)
  })

  test('written from two vaults under the same ids at once, is kept by one and refused to the other', async () => {
    const file = anId()
    const other = anId()
    await api.vault(ada, other)
    await api.item(ada, other, item)
    const [first, second] = await Promise.all([
      put(ada, `${vault}/${item}/${file}`, 'first'),
      put(ada, `${other}/${item}/${file}`, 'second'),
    ])
    expect([first.status, second.status].sort()).toEqual([201, 409])
    const [kept, word] = first.status === 201 ? [vault, 'first'] : [other, 'second']
    expect((await get(ada, `${kept}/${item}/${file}`)).text).toBe(word)
  })

  test('is refused without its length', async () => {
    const answer = await call(env, `/v2/pass/files/${vault}/${item}/${anId()}`, {
      method: 'PUT',
      raw: 'streamed',
      token: ada.token,
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect(answer.status).toBe(411)
  })

  test('is deleted with all its parts', async () => {
    const at = `${vault}/${item}/${anId()}`
    await put(ada, at, 'a', '?part=0&parts=2')
    await put(ada, at, 'b', '?part=1&parts=2')
    expect((await passCall(env, ada, 'DELETE', `/files/${at}`)).status).toBe(200)
    expect((await get(ada, at)).status).toBe(404)
    expect(objects()).toEqual([])
    expect((await passCall(env, ada, 'DELETE', `/files/${at}`)).status).toBe(404)
  })
})

describe('the files of an item', () => {
  test('go with the item', async () => {
    const at = `${vault}/${item}/${anId()}`
    await put(ada, at, 'kept')
    expect((await passCall(env, ada, 'DELETE', `/items/${vault}/${item}?rev=1`)).status).toBe(200)
    expect((await get(ada, at)).status).toBe(404)
    await sweepLeftovers(env)
    expect(objects()).toEqual([])
  })

  test('go with the vault', async () => {
    const at = `${vault}/${item}/${anId()}`
    await put(ada, at, 'kept')
    await api.vault(ada, anId())
    expect((await passCall(env, ada, 'DELETE', `/vaults/${vault}`)).status).toBe(200)
    await sweepLeftovers(env)
    expect(objects()).toEqual([])
    expect(env.db.prepare('select count(*) as n from pass_file_parts').get()).toEqual({ n: 0 })
  })

  test('move with the item to its new vault', async () => {
    const file = anId()
    await put(ada, `${vault}/${item}/${file}`, 'moving')
    const to = anId()
    await api.vault(ada, to)
    const moved = await passCall(env, ada, 'POST', `/items/${vault}/${item}/move`, {
      to,
      rev: 1,
      key: 'a2V5a2V5a2V5a2V5',
      body: 'Ym9keWJvZHlib2R5',
      keyVersion: 1,
    })
    expect(moved.status).toBe(200)
    expect((await get(ada, `${to}/${item}/${file}`)).text).toBe('moving')
    expect((await get(ada, `${vault}/${item}/${file}`)).status).toBe(404)
    await sweepLeftovers(env)
    expect(objects()).toHaveLength(1)
  })

  test('stay when a leftover of the same name was written before they came back', async () => {
    const file = anId()
    const at = `${vault}/${item}/${file}`
    await put(ada, at, 'back')
    env.db
      .prepare('insert into leftovers (what, since) values (?, 1)')
      .run(`pass/files/${item}/${file}/0`)
    await sweepLeftovers(env)
    expect((await get(ada, at)).text).toBe('back')
  })
})

describe('a file part written while its item or its writer goes', () => {
  test.each([
    [
      'the item is deleted',
      () =>
        env.db.prepare("update pass_items set deleted_at = 1, body = '' where id = ?").run(item),
      404,
    ],
    [
      'the writer is removed',
      () =>
        env.db
          .prepare("update pass_members set state = 'removed' where email = 'bob@example.com'")
          .run(),
      404,
    ],
    [
      'the writer becomes a viewer',
      () =>
        env.db
          .prepare("update pass_members set role = 'viewer' where email = 'bob@example.com'")
          .run(),
      403,
    ],
  ] as const)('is not kept when %s', async (_, goes, status) => {
    const bob = await person(env, 'bob@example.com')
    vault = await sharedVault(env, ada, bob)
    item = anId()
    await api.item(ada, vault, item)
    env.justBefore(/insert into pass_file_parts/, goes)
    expect((await put(bob, `${vault}/${item}/${anId()}`, 'part', '?part=0&parts=1')).status).toBe(
      status,
    )
    expect(env.db.prepare('select count(*) as n from pass_file_parts').get()).toEqual({ n: 0 })
    expect(objects()).toEqual([])
  })
})
