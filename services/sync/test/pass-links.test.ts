import { type LinkRow, linkOpenedIn, linkRowIn, LONGEST_LINK, MOST_LINKS } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import { anId, pass, passCall, type Person, person, sealed, sharedVault } from './pass-fakes'

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

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

const DAY = 24 * 60 * 60 * 1000

function makeLink(
  who: Person,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; json: { link?: LinkRow; error?: string } }> {
  return passCall(env, who, 'POST', '/links', {
    id: anId(),
    vault,
    item,
    body: sealed(200),
    expires: Date.now() + DAY,
    views: null,
    ...overrides,
  })
}

const open = (id: string, machine = '203.0.113.1') =>
  call<{ body?: string; expires?: number; left?: number | null; error?: string }>(
    env,
    `/v1/pass-link/${id}`,
    { headers: { 'cf-connecting-ip': machine } },
  )

describe('a secure link', () => {
  test('is made by an editor, listed, and opened by anybody without an account', async () => {
    const body = sealed(200)
    const made = await makeLink(ada, { body, views: 3 })
    expect(made.status).toBe(200)
    const link = made.json.link!
    expect(linkRowIn(link)).toEqual(link)

    const listed = await passCall<{ links: LinkRow[] }>(env, ada, 'GET', '/links')
    expect(listed.json.links).toEqual([link])

    const opened = await open(link.id)
    expect(opened.status).toBe(200)
    expect(opened.json).toEqual({ body, expires: link.expires, left: 2 })
    expect(linkOpenedIn(opened.json)).toEqual(opened.json)
    expect(opened.headers.get('cache-control')).toBe('no-store')
    expect(opened.headers.get('referrer-policy')).toBe('no-referrer')
    expect(opened.headers.get('x-robots-tag')).toBe('noindex')

    const seen = await passCall<{ links: LinkRow[] }>(env, ada, 'GET', '/links')
    expect(seen.json.links[0]?.seen).toBe(1)
  })

  test('is gone once its views are used up, and forgets what it held', async () => {
    const link = (await makeLink(ada, { views: 2 })).json.link!
    expect((await open(link.id)).json.left).toBe(1)
    expect((await open(link.id)).json.left).toBe(0)
    const third = await open(link.id)
    expect(third.status).toBe(410)
    expect(third.headers.get('cache-control')).toBe('no-store')
    expect(env.db.prepare('select body from pass_links').get()).toEqual({ body: '' })
  })

  test('with no limit on views says none are left to count', async () => {
    const link = (await makeLink(ada)).json.link!
    for (let one = 0; one < 3; one++) expect((await open(link.id)).json.left).toBeNull()
  })

  test('is gone once it expires', async () => {
    const link = (await makeLink(ada)).json.link!
    vi.useFakeTimers({ now: Date.now() + DAY + 1, toFake: ['Date'] })
    expect((await open(link.id)).status).toBe(410)
  })

  test('that never was is not found', async () => {
    expect((await open(anId())).status).toBe(404)
  })

  test('is deleted one at a time, or all the expired and used up at once', async () => {
    const one = (await makeLink(ada)).json.link!
    const used = (await makeLink(ada, { views: 1 })).json.link!
    const kept = (await makeLink(ada)).json.link!
    await open(used.id)

    expect((await passCall(env, ada, 'DELETE', `/links/${one.id}`)).status).toBe(200)
    expect((await passCall(env, ada, 'DELETE', `/links/${one.id}`)).status).toBe(404)
    expect((await open(one.id)).status).toBe(404)

    expect((await passCall(env, ada, 'DELETE', '/links?expired=1')).json).toEqual({ deleted: 1 })
    const left = await passCall<{ links: LinkRow[] }>(env, ada, 'GET', '/links')
    expect(left.json.links.map((link) => link.id)).toEqual([kept.id])
    expect((await passCall(env, ada, 'DELETE', '/links')).status).toBe(400)
  })

  test('counts only the links still open against how many one may make', async () => {
    const live = (await makeLink(ada)).json.link!
    const userId = (
      env.db.prepare('select user_id from pass_links where id = ?').get(live.id) as {
        user_id: string
      }
    ).user_id
    const dead = env.db.prepare(
      `insert into pass_links
         (id, user_id, vault_id, item_id, body, expires_at, max_views, views, created_at)
       values (?, ?, ?, ?, '', ?, null, 0, ?)`,
    )
    for (let at = 0; at < MOST_LINKS; at++) dead.run(anId(), userId, vault, item, 1, 1)

    const made = await makeLink(ada)
    expect(made.status, made.json.error).toBe(200)
  })

  test('is somebody else’s to delete only if it is theirs', async () => {
    const link = (await makeLink(ada)).json.link!
    const bob = await person(env, 'bob@example.com')
    expect((await passCall(env, bob, 'DELETE', `/links/${link.id}`)).status).toBe(404)
    expect((await open(link.id)).status).toBe(200)
  })

  test('goes with its item', async () => {
    const link = (await makeLink(ada)).json.link!
    await passCall(env, ada, 'DELETE', `/items/${vault}/${item}?rev=1`)
    expect((await open(link.id)).status).toBe(404)
  })

  test('is not made for an item deleted while the link was being written', async () => {
    env.justBefore(/insert into pass_links/, () =>
      env.db.prepare("update pass_items set deleted_at = 1, body = '' where id = ?").run(item),
    )

    expect((await makeLink(ada)).status).toBe(404)
    expect(env.db.prepare('select count(*) as n from pass_links').get()).toEqual({ n: 0 })
  })

  test('is not made by a member removed while the link was being written', async () => {
    const bob = await person(env, 'bob@example.com')
    vault = await sharedVault(env, ada, bob, 'editor')
    item = anId()
    await api.item(ada, vault, item)
    env.justBefore(/insert into pass_links/, () =>
      env.db
        .prepare("update pass_members set state = 'removed' where vault_id = ? and email = ?")
        .run(vault, 'bob@example.com'),
    )

    expect((await makeLink(bob)).status).toBe(404)
    expect(env.db.prepare('select count(*) as n from pass_links').get()).toEqual({ n: 0 })
  })

  test('goes when its maker is made a viewer, who could not have made it', async () => {
    const bob = await person(env, 'bob@example.com')
    vault = await sharedVault(env, ada, bob, 'editor')
    item = anId()
    await api.item(ada, vault, item)
    const theirs = (await makeLink(bob)).json.link!
    const mine = (await makeLink(ada)).json.link!

    const demoted = await passCall(env, ada, 'PUT', `/vaults/${vault}/members/bob@example.com`, {
      role: 'viewer',
      vouch: null,
    })
    expect(demoted.status).toBe(200)

    expect((await open(theirs.id)).status).toBe(404)
    expect((await open(mine.id)).status).toBe(200)
  })

  test('is not made by a viewer, or for an item that is not there', async () => {
    const bob = await person(env, 'bob@example.com')
    vault = await sharedVault(env, ada, bob, 'viewer')
    item = anId()
    await api.item(ada, vault, item)
    expect((await makeLink(bob)).status).toBe(403)
    expect((await makeLink(ada, { item: anId() })).status).toBe(404)
  })

  test(`lasts at most 30 days, and is seen at most 100 times`, async () => {
    const at = Date.now()
    for (const bad of [
      { expires: at - 1 },
      { expires: at + LONGEST_LINK + 60_000 },
      { views: 0 },
      { views: 101 },
      { views: 1.5 },
      { body: 'not base64' },
      { id: 'short' },
    ]) {
      expect((await makeLink(ada, bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await makeLink(ada, { expires: at + LONGEST_LINK - 60_000, views: 100 })).status).toBe(
      200,
    )
  })

  test('is opened only so often from one machine', async () => {
    const link = (await makeLink(ada)).json.link!
    let status = 200
    for (let tries = 0; tries < 301 && status === 200; tries++)
      status = (await open(link.id)).status
    expect(status).toBe(429)
    expect((await open(link.id, '203.0.113.2')).status).toBe(200)
  })
})
