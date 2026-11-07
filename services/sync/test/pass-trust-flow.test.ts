import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type TestEnv, testEnv } from './harness'
import { content, type Device, Flow, kit, type Kit, names } from './pass-flow'
import { anId, type Person, person } from './pass-fakes'

let env: TestEnv
let k: Kit
let ada: Person
let bob: Person
let cy: Person
let flow: Flow

beforeEach(async () => {
  env = testEnv()
  k = await kit()
  ada = await person(env, 'ada@example.com')
  bob = await person(env, 'bob@example.com')
  cy = await person(env, 'cy@example.com')
  flow = new Flow(env, k, ada)
})

afterEach(() => env.close())

type Value = string | number | null

function asTheAccount(sql: string, ...values: Value[]): void {
  env.db.prepare('update pass_seq set seq = seq + 1 where id = 1').run()
  env.db.prepare(sql).run(...values)
}

const SEQ = '(select seq from pass_seq where id = 1)'

function rowOf(sql: string, ...values: Value[]): Record<string, Value> {
  return env.db.prepare(sql).get(...values) as Record<string, Value>
}

const reasons = (device: Device) => device.problems.map((one) => one.reason)

function keyOf(device: Device, vault: string): Uint8Array<ArrayBuffer> {
  const box = device.held?.vaults.get(vault)
  if (!box) throw new Error('no such vault')
  return box.key
}

async function edited(device: Device, who: Person, id: string, password: string): Promise<void> {
  await device.change(id, (one) => ({
    ...one,
    content: { ...one.content, password } as typeof one.content,
    modified: Date.now(),
  }))
  expect(await flow.synced(device, who)).toBe('synced')
}

async function swapped(): Promise<{ pub: string; signPub: string }> {
  const other = await flow.deviceOf(await person(env, 'mallory@example.com'))
  return { pub: other.held!.opened.pair.pub, signPub: other.held!.opened.signer!.pub }
}

describe('a vault key the account hands out', () => {
  test('is refused when the owner did not sign it, and the old key is kept', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'editor')
    const kept = keyOf(b, vault)
    const theirs = k.newKey()
    const forger = await k.newSigner()
    const proof = await k.keyProofOf(forger, vault, 2, theirs, null)
    asTheAccount(
      `update pass_members set key = ?, key_version = 2, seq = ${SEQ}
        where vault_id = ? and email = ?`,
      await k.wrapVaultKey(theirs, b.held!.opened.pair.pub, vault),
      vault,
      bob.email,
    )
    asTheAccount(
      `update pass_vaults set key_version = 2, key_proof = ?, seq = ${SEQ} where id = ?`,
      JSON.stringify(proof),
      vault,
    )

    expect(await flow.synced(b, bob)).toBe('synced')
    expect(keyOf(b, vault)).toEqual(kept)
    expect(b.held!.vaults.get(vault)!.row.keyVersion).toBe(1)
    expect(reasons(b)).toContain('unproven')
    expect(content(b, id).password).toBe('one')
  })

  test('is refused when it is older than the one the device holds', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'editor')
    await flow.joined(a, vault, cy, 'editor')
    const old = rowOf(
      'select key from pass_members where vault_id = ? and email = ?',
      vault,
      bob.email,
    )
    expect(await k.removedMember(flow.sharing(a, ada), vault, cy.email)).toBe(2)
    expect(await flow.synced(b, bob)).toBe('synced')
    const renewed = keyOf(b, vault)

    asTheAccount(
      `update pass_members set key = ?, key_version = 1, seq = ${SEQ}
        where vault_id = ? and email = ?`,
      old.key ?? null,
      vault,
      bob.email,
    )
    asTheAccount(`update pass_vaults set key_version = 1, seq = ${SEQ} where id = ?`, vault)
    expect(await flow.synced(b, bob)).toBe('synced')
    expect(b.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(keyOf(b, vault)).toEqual(renewed)
    expect(reasons(b)).toContain('older')
    expect(content(b, id).title).toBe('Bank')
  })

  test('for a vault the reader never made nor accepted is left out', async () => {
    const b = await flow.deviceOf(bob)
    const injected = anId()
    const key = k.newKey()
    const forger = await k.newSigner()
    const meta = await k.sealVault(key, injected, {
      v: 1,
      name: 'Injected',
      description: '',
      color: 'red',
      icon: 'key',
      folders: [],
      hidePasswordsFromViewers: false,
    })
    asTheAccount(
      `insert into pass_vaults (id, owner_id, rev, meta, key_version, deleted_at, seq, key_proof)
       values (?, ?, 1, ?, 1, null, ${SEQ}, ?)`,
      injected,
      bob.id,
      meta,
      JSON.stringify(await k.keyProofOf(forger, injected, 1, key, null)),
    )
    asTheAccount(
      `insert into pass_members
         (vault_id, email, user_id, role, state, key, key_version, invited_by, seq, accepted)
       values (?, ?, ?, 'owner', 'active', ?, 1, null, ${SEQ}, ?)`,
      injected,
      bob.email,
      bob.id,
      await k.wrapVaultKey(key, b.held!.opened.pair.pub, injected),
      JSON.stringify(await k.acceptedOf(forger, injected, forger.pub)),
    )

    expect(await flow.synced(b, bob)).toBe('synced')
    expect(names(b)).not.toContain('Injected')
    expect(b.held!.vaults.has(injected)).toBe(false)
    expect(reasons(b)).toContain('unasked')
  })
})

describe('an item the account hands out', () => {
  test('is refused when it is an older copy than the one the device holds', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'editor')
    const old = rowOf('select key, body from pass_items where vault_id = ? and id = ?', vault, id)
    await edited(a, ada, id, 'two')
    expect(await flow.synced(b, bob)).toBe('synced')
    expect(content(b, id).password).toBe('two')

    asTheAccount(
      `update pass_items set key = ?, body = ?, rev = rev + 1, seq = ${SEQ}
        where vault_id = ? and id = ?`,
      old.key ?? null,
      old.body ?? null,
      vault,
      id,
    )
    expect(await flow.synced(b, bob)).toBe('synced')
    expect(content(b, id).password).toBe('two')
    expect(reasons(b)).toContain('replayed')
  })
})

describe('after somebody is removed', () => {
  test('the keys they held open nothing the vault holds, and the others read on', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'editor')
    const c = await flow.joined(a, vault, cy, 'editor')
    const oldItemKey = b.held!.items.get(id)!.key
    const oldVaultKey = keyOf(b, vault)

    expect(await k.removedMember(flow.sharing(a, ada), vault, bob.email)).toBe(2)
    const [row] = await flow.apiOf(ada).allVaultItems(vault)
    await expect(
      k.openItemBody(oldItemKey, vault, id, row!.body, row!.keyVersion),
    ).rejects.toThrow()
    await expect(
      k.openItem(oldVaultKey, vault, id, row!.key, row!.body, row!.keyVersion),
    ).rejects.toThrow()
    expect(await flow.synced(c, cy)).toBe('synced')
    expect(content(c, id)).toMatchObject({ title: 'Bank', password: 'one' })
    await edited(a, ada, id, 'after')
    expect(await flow.synced(c, cy)).toBe('synced')
    expect(content(c, id).password).toBe('after')
  })
})

describe('a new key made by somebody other than the owner', () => {
  test('is taken from a manager the owner made, and refused from one the account vouches for', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'manager')
    await flow.joined(a, vault, cy, 'editor')
    expect(await k.removedMember(flow.sharing(b, bob), vault, cy.email)).toBe(2)
    expect(await flow.synced(a, ada)).toBe('synced')
    expect(a.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(a.problems).toEqual([])
    expect(content(a, id).title).toBe('Bank')

    const forger = await k.newSigner()
    asTheAccount(
      `update pass_members set vouch = ?, seq = ${SEQ} where vault_id = ? and email = ?`,
      await k.vouchFor(forger, vault, b.held!.opened.signer!.pub),
      vault,
      bob.email,
    )
    await expect(k.removedMember(flow.sharing(b, bob), vault, ada.email)).rejects.toThrow(
      'Only the owner, or a manager the owner made',
    )
  })

  test('lets a manager the owner made invite, and the invitee trusts the owner', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'manager')
    const c = await flow.deviceOf(cy)
    expect(await flow.invited(b, vault, cy.email, 'viewer', bob)).toBe('pending')
    await flow.accepted(c, cy, vault)
    expect(content(c, id).title).toBe('Bank')
    expect(await k.removedMember(flow.sharing(a, ada), vault, bob.email)).toBe(2)
    expect(await flow.synced(c, cy)).toBe('synced')
    expect(c.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(c.problems).toEqual([])
  })

  test('is taken from the heir the owner handed the vault to', async () => {
    const { a, vault, id } = await flow.family()
    const b = await flow.joined(a, vault, bob, 'editor')
    await flow.joined(a, vault, cy, 'editor')
    await k.handedOn(flow.sharing(a, ada), vault, bob.email)
    expect(await flow.synced(b, bob)).toBe('synced')
    expect(await k.removedMember(flow.sharing(b, bob), vault, cy.email)).toBe(2)
    expect(await flow.synced(a, ada)).toBe('synced')
    expect(a.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(a.problems).toEqual([])
    expect(content(a, id).title).toBe('Bank')
  })
})

describe('the key Pass wraps a vault’s key to', () => {
  test('is never one the account swapped in, and one this device knew may not change', async () => {
    const { a, vault } = await flow.family()
    const b = await flow.deviceOf(bob)
    const real = { pub: b.held!.opened.pair.pub, signPub: b.held!.opened.signer!.pub }
    const fake = await swapped()
    flow.tamper = async (request, answer) =>
      new URL(request.url).pathname.endsWith('/people/key') ? Response.json(fake) : answer

    const offered = await k.personFor(flow.sharing(a, ada), bob.email)
    expect(offered.code).toBe(await k.codeOf(fake))
    expect(offered.code).not.toBe(await k.codeOf(real))
    expect(await k.invitedState(flow.sharing(a, ada), vault, offered, 'editor')).toBe('confirm')
    expect(
      rowOf('select key from pass_members where vault_id = ? and email = ?', vault, bob.email).key,
    ).toBeNull()

    flow.tamper = null
    const honest = await flow.checked(a, ada, bob.email)
    expect(honest.code).toBe(await k.codeOf(real))
    flow.tamper = async (request, answer) =>
      new URL(request.url).pathname.endsWith('/people/key') ? Response.json(fake) : answer
    const changed = await k.personFor(flow.sharing(a, ada), bob.email)
    expect(changed.known).toBe('changed')
    await expect(k.confirmedMember(flow.sharing(a, ada), vault, changed)).rejects.toThrow(
      'not the one this device knew',
    )
    flow.tamper = null
    await k.confirmedMember(flow.sharing(a, ada), vault, honest)
    await flow.accepted(b, bob, vault)
    expect(names(b)).toContain('Family')
  })
})

describe('an invitation', () => {
  test('is refused when the account says another owner vouched for whoever sent it', async () => {
    const { a, vault } = await flow.family()
    const b = await flow.deviceOf(bob)
    expect(await flow.invited(a, vault, bob.email, 'editor')).toBe('pending')
    const forger = await k.newSigner()
    const vouch = await k.vouchFor(forger, vault, a.held!.opened.signer!.pub)
    asTheAccount(
      `update pass_members set pin = ?, seq = ${SEQ} where vault_id = ? and email = ?`,
      JSON.stringify({ owner: forger.pub, vouch }),
      vault,
      bob.email,
    )
    await expect(flow.accepted(b, bob, vault)).rejects.toThrow('not signed by the vault’s owner')
    expect(names(b)).not.toContain('Family')
  })

  test('from somebody whose key this device knew otherwise is refused', async () => {
    const { a, vault } = await flow.family()
    const b = await flow.deviceOf(bob)
    expect(await flow.invited(a, vault, bob.email, 'editor')).toBe('pending')
    const fake = await swapped()
    await k.confirmedPerson(b.rows, {
      email: ada.email,
      key: fake,
      code: await k.codeOf(fake),
      known: 'new',
    })
    await expect(flow.accepted(b, bob, vault)).rejects.toThrow('not the one this device knew')
  })
})
