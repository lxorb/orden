import { type Member, MOST_MEMBERS, memberIn } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'
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
let running: ReturnType<typeof hubs>
let ada: Person
let bob: Person
let cy: Person
let api: ReturnType<typeof pass>
let vault: string

beforeEach(async () => {
  env = testEnv()
  running = hubs(env)
  env.HUB = running.HUB
  ada = await person(env, 'ada@example.com')
  bob = await person(env, 'bob@example.com')
  cy = await person(env, 'cy@example.com')
  api = pass(env)
  vault = anId()
  await api.vault(ada, vault)
})

afterEach(() => env.close())

const membersOf = async (who: Person) =>
  (await passCall<{ members: Member[] }>(env, who, 'GET', `/vaults/${vault}/members`)).json.members

const told = () => running.asked.filter((one) => one.ask === 'pass').map((one) => one.id)

describe('an invitation with a key', () => {
  test('shows up for the invitee, and accepting it opens the vault to them', async () => {
    const key = sealed()
    const invited = await api.invite(ada, vault, 'Bob@Example.com', 'viewer', key)
    expect(invited.json).toEqual({ state: 'pending' })

    const changes = await api.changes(bob)
    expect(changes.invites).toEqual([
      {
        vault,
        from: ada.email,
        fromName: '',
        role: 'viewer',
        key,
        meta: expect.any(String),
        keyVersion: 1,
        fromKey: null,
        proof: null,
        pin: null,
      },
    ])
    expect(changes.vaults).toEqual([])

    const accepted = await api.accept(bob, vault)
    expect(accepted.status).toBe(200)
    const after = await api.changes(bob)
    expect(after.invites).toEqual([])
    expect(after.vaults).toEqual([
      expect.objectContaining({ id: vault, role: 'viewer', key, owner: false, members: 2 }),
    ])
  })

  test('declined, is gone for good', async () => {
    await api.invite(ada, vault, bob.email)
    expect((await passCall(env, bob, 'POST', `/invites/${vault}/decline`)).status).toBe(200)
    expect((await api.changes(bob)).invites).toEqual([])
    expect((await api.accept(bob, vault)).status).toBe(404)
    expect((await membersOf(ada)).map((one) => one.email)).toEqual([ada.email])
  })

  test('tells the invitee’s hub and the members’', async () => {
    await api.invite(ada, vault, bob.email)
    expect(new Set(told())).toEqual(new Set([ada.id, bob.id]))
  })
})

describe('an invitation without a key', () => {
  test('waits for the invitee’s keyring, then for a manager to confirm, then opens', async () => {
    await api.invite(ada, vault, bob.email, 'editor', null)
    expect((await membersOf(ada)).find((one) => one.email === bob.email)).toEqual({
      email: bob.email,
      name: '',
      role: 'editor',
      state: 'pending',
      pub: null,
      signPub: null,
      vouch: null,
    })
    expect((await api.accept(bob, vault)).json.error).toBe('this invitation has no key yet')

    const keyring = aKeyring()
    running.asked.length = 0
    await api.keyring(bob, 0, keyring)
    expect(told()).toContain(ada.id)
    const waiting = (await membersOf(ada)).find((one) => one.email === bob.email)
    expect(waiting).toMatchObject({ state: 'confirm', pub: keyring.pub })
    expect(memberIn(waiting)).toEqual(waiting)

    const key = sealed()
    const confirmed = await passCall(env, ada, 'PUT', `/vaults/${vault}/members/${bob.email}/key`, {
      key,
      keyVersion: 1,
    })
    expect(confirmed.status).toBe(200)
    expect((await api.changes(bob)).invites[0]?.key).toBe(key)
    expect((await api.accept(bob, vault)).status).toBe(200)
    expect((await membersOf(ada)).find((one) => one.email === bob.email)?.state).toBe('active')
  })

  test('to somebody who has a keyring already asks to be confirmed at once', async () => {
    await api.keyring(bob, 0, aKeyring())
    expect((await api.invite(ada, vault, bob.email, 'editor', null)).json.state).toBe('confirm')
  })

  test('to an address with no account waits for one', async () => {
    expect((await api.invite(ada, vault, 'new@example.com', 'viewer', null)).json.state).toBe(
      'pending',
    )
    const newcomer = await person(env, 'new@example.com')
    expect((await api.changes(newcomer)).invites).toHaveLength(1)
    await api.keyring(newcomer, 0, aKeyring())
    expect((await membersOf(ada)).find((one) => one.email === newcomer.email)?.state).toBe(
      'confirm',
    )
  })
})

describe('roles', () => {
  test('a viewer reads and does not write', async () => {
    vault = await sharedVault(env, ada, bob, 'viewer')
    expect((await api.item(bob, vault, anId())).status).toBe(403)
    expect((await api.vault(bob, vault, 1)).status).toBe(403)
    const item = anId()
    await api.item(ada, vault, item)
    expect((await api.changes(bob)).items.map((one) => one.id)).toEqual([item])
    expect((await passCall(env, bob, 'DELETE', `/items/${vault}/${item}?rev=1`)).status).toBe(403)
  })

  test('an editor writes items and does not invite or rename', async () => {
    vault = await sharedVault(env, ada, bob, 'editor')
    expect((await api.item(bob, vault, anId())).status).toBe(200)
    expect((await api.invite(bob, vault, cy.email)).status).toBe(403)
    expect((await api.vault(bob, vault, 1)).status).toBe(403)
  })

  test('a manager invites, renames, changes roles, and does not delete the vault', async () => {
    vault = await sharedVault(env, ada, bob, 'manager')
    expect((await api.invite(bob, vault, cy.email, 'viewer')).status).toBe(200)
    expect((await api.vault(bob, vault, 1)).status).toBe(200)
    expect(
      (await passCall(env, bob, 'PUT', `/vaults/${vault}/members/${cy.email}`, { role: 'editor' }))
        .status,
    ).toBe(200)
    expect((await passCall(env, bob, 'DELETE', `/vaults/${vault}`)).status).toBe(403)
    expect(
      (await passCall(env, bob, 'PUT', `/vaults/${vault}/owner`, { email: bob.email })).status,
    ).toBe(403)
  })

  test('nobody makes an owner by a role, or changes the owner’s', async () => {
    vault = await sharedVault(env, ada, bob, 'manager')
    expect((await api.invite(bob, vault, cy.email, 'owner')).status).toBe(400)
    await api.invite(bob, vault, cy.email, 'viewer')
    expect(
      (await passCall(env, bob, 'PUT', `/vaults/${vault}/members/${cy.email}`, { role: 'owner' }))
        .status,
    ).toBe(400)
    expect(
      (await passCall(env, bob, 'PUT', `/vaults/${vault}/members/${ada.email}`, { role: 'viewer' }))
        .status,
    ).toBe(409)
    expect(
      (await passCall(env, bob, 'DELETE', `/vaults/${vault}/members/${ada.email}`)).status,
    ).toBe(409)
  })

  test('a changed role shows in the member’s changes', async () => {
    vault = await sharedVault(env, ada, bob, 'viewer')
    const before = (await api.changes(bob)).seq
    await passCall(env, ada, 'PUT', `/vaults/${vault}/members/${bob.email}`, { role: 'editor' })
    const after = await api.changes(bob, before)
    expect(after.vaults.map((one) => one.role)).toEqual(['editor'])
  })
})

describe('leaving and removing', () => {
  test('a member leaves on their own, and the owner cannot', async () => {
    vault = await sharedVault(env, ada, bob)
    expect(
      (await passCall(env, bob, 'DELETE', `/vaults/${vault}/members/${bob.email}`)).status,
    ).toBe(200)
    expect((await membersOf(ada)).map((one) => one.email)).toEqual([ada.email])
    expect(
      (await passCall(env, ada, 'DELETE', `/vaults/${vault}/members/${ada.email}`)).status,
    ).toBe(409)
  })

  test('an editor does not remove anybody else', async () => {
    vault = await sharedVault(env, ada, bob)
    await api.invite(ada, vault, cy.email)
    await api.accept(cy, vault)
    expect(
      (await passCall(env, bob, 'DELETE', `/vaults/${vault}/members/${cy.email}`)).status,
    ).toBe(403)
  })

  test('a removed member writes nothing more, and may be asked back', async () => {
    vault = await sharedVault(env, ada, bob)
    running.asked.length = 0
    await passCall(env, ada, 'DELETE', `/vaults/${vault}/members/${bob.email}`)
    expect(told()).toContain(bob.id)
    expect((await api.item(bob, vault, anId())).status).toBe(404)
    expect((await api.invite(ada, vault, bob.email)).status).toBe(200)
    expect((await api.accept(bob, vault)).status).toBe(200)
    expect((await api.item(bob, vault, anId())).status).toBe(200)
  })

  test(`a vault holds at most ${String(MOST_MEMBERS)} people`, async () => {
    for (let one = 1; one < MOST_MEMBERS; one++) {
      expect((await api.invite(ada, vault, `p${String(one)}@example.com`)).status).toBe(200)
    }
    const more = await api.invite(ada, vault, 'more@example.com')
    expect(more.status).toBe(409)
    expect(more.json.error).toBe('that is as many people as one vault holds')
    expect((await api.invite(ada, vault, 'p1@example.com')).json.error).toBe(
      'already in this vault',
    )
  })
})

describe('handing a vault on', () => {
  test('makes an active member the owner and the old owner a manager', async () => {
    vault = await sharedVault(env, ada, bob)
    expect(
      (await passCall(env, ada, 'PUT', `/vaults/${vault}/owner`, { email: bob.email })).status,
    ).toBe(200)
    const roles = Object.fromEntries((await membersOf(ada)).map((one) => [one.email, one.role]))
    expect(roles).toEqual({ [ada.email]: 'manager', [bob.email]: 'owner' })
    const bobs = (await api.changes(bob)).vaults[0]!
    expect(bobs).toMatchObject({ owner: true, role: 'owner' })
    expect((await passCall(env, ada, 'DELETE', `/vaults/${vault}`)).status).toBe(403)
    expect(
      (await passCall(env, bob, 'DELETE', `/vaults/${vault}/members/${ada.email}`)).status,
    ).toBe(200)
  })

  test('not to somebody who has not accepted', async () => {
    await api.invite(ada, vault, bob.email)
    expect(
      (await passCall(env, ada, 'PUT', `/vaults/${vault}/owner`, { email: bob.email })).status,
    ).toBe(404)
  })
})

describe('a new vault key', () => {
  const rotate = (who: Person, body: Record<string, unknown>) =>
    passCall(env, who, 'POST', `/vaults/${vault}/rotate`, body)

  const resealed = (rev: number) => ({ key: sealed(), body: sealed(120), rev })

  test('covers every item at its revision, renewing its key and body, all at once', async () => {
    vault = await sharedVault(env, ada, bob)
    const one = anId()
    const two = anId()
    await api.item(ada, vault, one)
    await api.item(ada, vault, two)
    await api.item(ada, vault, two, 1)

    const keys = { [ada.email]: sealed(), [bob.email]: sealed() }
    const items = { [one]: resealed(1), [two]: resealed(2) }
    const rotated = await rotate(ada, {
      rev: 1,
      keyVersion: 2,
      meta: sealed(),
      members: keys,
      items,
    })
    expect(rotated.json).toEqual({ rev: 2, keyVersion: 2 })

    const bobs = await api.changes(bob)
    expect(bobs.vaults[0]).toMatchObject({ keyVersion: 2, key: keys[bob.email] })
    expect(bobs.items.every((row) => row.keyVersion === 2)).toBe(true)
    const byId = new Map(bobs.items.map((row) => [row.id, row]))
    expect(byId.get(one)).toMatchObject({ key: items[one]!.key, body: items[one]!.body, rev: 2 })
    expect(byId.get(two)).toMatchObject({ key: items[two]!.key, body: items[two]!.body, rev: 3 })
    expect(env.db.prepare('select count(*) as n from pass_versions').get()).toEqual({ n: 0 })
    expect((await api.item(bob, vault, anId(), 0, 1)).status).toBe(409)
    expect((await api.item(bob, vault, anId(), 0, 2)).status).toBe(200)
  })

  test('is refused when it leaves out an item or names an old revision, and nothing changes', async () => {
    vault = await sharedVault(env, ada, bob)
    const item = anId()
    await api.item(ada, vault, item)
    const members = { [ada.email]: sealed(), [bob.email]: sealed() }

    const noItem = await rotate(ada, { rev: 1, keyVersion: 2, meta: sealed(), members, items: {} })
    expect(noItem.status).toBe(409)
    expect(noItem.json.error).toBe('a new key covers every member and every item')
    await api.item(ada, vault, item, 1)
    const old = await rotate(ada, {
      rev: 1,
      keyVersion: 2,
      meta: sealed(),
      members,
      items: { [item]: resealed(1) },
    })
    expect(old.status).toBe(409)
    expect((await api.changes(bob)).vaults[0]?.keyVersion).toBe(1)
    expect(
      (
        await rotate(ada, {
          rev: 1,
          keyVersion: 2,
          meta: sealed(),
          members,
          items: { [item]: 'x' },
        })
      ).status,
    ).toBe(400)
  })

  test('is wrapped to the owner and to whoever renews it', async () => {
    vault = await sharedVault(env, ada, bob, 'manager')
    const body = { rev: 1, keyVersion: 2, meta: sealed(), items: {} }
    expect((await rotate(bob, { ...body, members: { [bob.email]: sealed() } })).json.error).toBe(
      'a new key is wrapped to the owner and to whoever renews it',
    )
    expect((await rotate(ada, { ...body, members: { [bob.email]: sealed() } })).status).toBe(409)
    expect(
      (await rotate(bob, { ...body, members: { [ada.email]: sealed(), [bob.email]: sealed() } }))
        .status,
    ).toBe(200)
  })

  test('puts a member it leaves out back to be confirmed, without a key', async () => {
    vault = await sharedVault(env, ada, bob)
    await api.keyring(bob, 0, aKeyring())
    const rotated = await rotate(ada, {
      rev: 1,
      keyVersion: 2,
      meta: sealed(),
      members: { [ada.email]: sealed() },
      items: {},
    })
    expect(rotated.status).toBe(200)
    expect((await membersOf(ada)).find((one) => one.email === bob.email)).toMatchObject({
      state: 'confirm',
    })
    const bobs = await api.changes(bob)
    expect(bobs.invites[0]).toMatchObject({ vault, key: null })
    expect(bobs.vaults).toEqual([])
  })

  test('is refused over an older revision or a skipped version, and from an editor', async () => {
    vault = await sharedVault(env, ada, bob)
    const body = {
      rev: 1,
      keyVersion: 2,
      meta: sealed(),
      members: { [ada.email]: sealed(), [bob.email]: sealed() },
      items: {},
    }
    expect((await rotate(bob, body)).status).toBe(403)
    expect((await rotate(ada, { ...body, keyVersion: 3 })).json.error).toBe('stale')
    expect((await rotate(ada, { ...body, rev: 2 })).json.error).toBe('stale')
    expect((await rotate(ada, { ...body, members: 'x' })).status).toBe(400)
    expect((await rotate(ada, { ...body, proof: { by: 'x' } })).status).toBe(400)
  })

  test('drops the key of an invitation it leaves out, which then waits to be confirmed', async () => {
    await api.keyring(bob, 0, aKeyring())
    await api.invite(ada, vault, bob.email, 'viewer', sealed())
    await rotate(ada, {
      rev: 1,
      keyVersion: 2,
      meta: sealed(),
      members: { [ada.email]: sealed() },
      items: {},
    })
    expect((await membersOf(ada)).find((one) => one.email === bob.email)?.state).toBe('confirm')
    expect((await api.changes(bob)).invites[0]?.key).toBeNull()
  })
})

describe('the members list', () => {
  test('shows who has not joined yet without their name, and their key to managers only', async () => {
    const dan = await person(env, 'dan@example.com')
    await api.invite(ada, vault, dan.email, 'viewer')
    await api.accept(dan, vault)
    env.db.prepare('update users set name = ? where email = ?').run('Bob Builder', bob.email)
    expect((await api.keyring(bob)).status).toBe(200)
    await api.invite(ada, vault, bob.email, 'editor')

    const invited = (members: Member[]) => members.find((one) => one.email === bob.email)
    expect(invited(await membersOf(ada))).toMatchObject({ name: '', state: 'pending' })
    expect(invited(await membersOf(ada))?.pub).toEqual(expect.any(String))
    expect(invited(await membersOf(dan))).toMatchObject({ name: '', pub: null })
    expect((await membersOf(dan)).find((one) => one.email === ada.email)?.state).toBe('active')

    await api.accept(bob, vault)
    expect(invited(await membersOf(dan))).toMatchObject({ name: 'Bob Builder' })
    expect(invited(await membersOf(dan))?.pub).toEqual(expect.any(String))
  })
})

describe('inviting', () => {
  test('is limited to 100 invitations an hour by one person', async () => {
    env.db
      .prepare(`insert into limits (scope, key, count, until) values ('pass-invites', ?, 99, ?)`)
      .run(ada.id, Date.now() + 3_600_000)
    expect((await api.invite(ada, vault, bob.email)).status).toBe(200)
    const many = await api.invite(ada, vault, cy.email)
    expect(many.status).toBe(429)
  })
})
