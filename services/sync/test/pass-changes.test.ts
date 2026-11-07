import { changesIn, type ItemPage, MOST_PAGE } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type TestEnv, testEnv } from './harness'
import { anId, pass, passCall, type Person, person, sharedVault } from './pass-fakes'

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

describe('the changes', () => {
  test('are what was written after the sequence number named, in the shape the app reads', async () => {
    const vault = anId()
    await api.vault(ada, vault)
    const one = anId()
    await api.item(ada, vault, one)
    const first = await api.changes(ada)
    expect(changesIn(first)).toEqual(first)
    expect(first.items.map((row) => row.id)).toEqual([one])

    const two = anId()
    await api.item(ada, vault, two)
    const second = await api.changes(ada, first.seq)
    expect(second.items.map((row) => row.id)).toEqual([two])
    expect(second.vaults).toEqual([])
    expect(second.seq).toBeGreaterThan(first.seq)

    expect(await api.changes(ada, second.seq)).toEqual({
      seq: second.seq,
      more: false,
      keyring: null,
      vaults: [],
      items: [],
      invites: [],
    })
  })

  test(`come ${String(MOST_PAGE)} items at a time, and the pages add up to everything once`, async () => {
    const vault = anId()
    await api.vault(ada, vault)
    const ids = new Set<string>()
    for (let made = 0; made < MOST_PAGE + 20; made++) {
      const id = anId()
      ids.add(id)
      await api.item(ada, vault, id)
    }

    const first = await api.changes(ada)
    expect(first.more).toBe(true)
    expect(first.items).toHaveLength(MOST_PAGE)
    const second = await api.changes(ada, first.seq)
    expect(second.more).toBe(false)
    expect(second.items).toHaveLength(20)

    const seen = [...first.items, ...second.items].map((row) => row.id)
    expect(new Set(seen)).toEqual(ids)
    expect(seen).toHaveLength(ids.size)
  })

  test('keep a rotated vault’s items apart, so its pages still add up', async () => {
    const vault = anId()
    await api.vault(ada, vault)
    const ids: string[] = []
    for (let made = 0; made < MOST_PAGE + 3; made++) {
      const id = anId()
      ids.push(id)
      await api.item(ada, vault, id)
    }
    const before = (await api.changes(ada, 0)).seq
    const all = await passCall<ItemPage>(env, ada, 'GET', `/vaults/${vault}/items`)
    expect(all.json.more).toBe(true)

    const rotated = await passCall(env, ada, 'POST', `/vaults/${vault}/rotate`, {
      rev: 1,
      keyVersion: 2,
      meta: 'AAAA',
      members: { [ada.email]: 'BBBB' },
      items: Object.fromEntries(ids.map((id) => [id, { key: 'CCCC', body: 'DDDD', rev: 1 }])),
    })
    expect(rotated.status).toBe(200)

    let since = 0
    const seen: string[] = []
    for (let page = 0; page < 5; page++) {
      const changes = await api.changes(ada, since)
      seen.push(...changes.items.map((row) => row.id))
      since = changes.seq
      if (!changes.more) break
    }
    expect(seen.sort()).toEqual([...ids].sort())
    expect(since).toBeGreaterThan(before)
  })

  test('show only the vaults one is in, and their items', async () => {
    const mine = anId()
    await api.vault(ada, mine)
    await api.item(ada, mine, anId())
    const theirs = anId()
    await api.vault(bob, theirs)
    await api.item(bob, theirs, anId())

    const changes = await api.changes(ada)
    expect(changes.vaults.map((one) => one.id)).toEqual([mine])
    expect(changes.items.map((one) => one.vault)).toEqual([mine])
  })

  test('list a vault’s items whole for somebody new to it', async () => {
    const vault = anId()
    await api.vault(ada, vault)
    const ids: string[] = []
    for (let made = 0; made < MOST_PAGE + 2; made++) {
      const id = anId()
      ids.push(id)
      await api.item(ada, vault, id)
    }
    await api.invite(ada, vault, bob.email)
    await api.accept(bob, vault)

    const first = await passCall<ItemPage>(env, bob, 'GET', `/vaults/${vault}/items`)
    expect(first.json.more).toBe(true)
    const last = first.json.items.at(-1)?.id ?? ''
    const second = await passCall<ItemPage>(env, bob, 'GET', `/vaults/${vault}/items?after=${last}`)
    expect(second.json.more).toBe(false)
    expect([...first.json.items, ...second.json.items].map((one) => one.id).sort()).toEqual(
      ids.sort(),
    )
  })

  test('stop at a vault one was removed from: it comes once as deleted, then nothing of it', async () => {
    const vault = await sharedVault(env, ada, bob)
    await api.item(ada, vault, anId())
    const before = (await api.changes(bob)).seq

    await passCall(env, ada, 'DELETE', `/vaults/${vault}/members/${bob.email}`)
    await api.item(ada, vault, anId())

    const after = await api.changes(bob, before)
    expect(after.vaults).toEqual([
      expect.objectContaining({ id: vault, deleted: true, key: null, meta: '' }),
    ])
    expect(after.items).toEqual([])
    expect((await api.changes(bob, after.seq)).vaults).toEqual([])
    expect((await passCall(env, bob, 'GET', `/vaults/${vault}/items`)).status).toBe(404)
  })

  test('refuse a sequence number that is not one', async () => {
    for (const since of ['-1', 'x', '1.5']) {
      expect((await passCall(env, ada, 'GET', `/changes?since=${since}`)).status).toBe(400)
    }
  })
})
