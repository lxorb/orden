import type { Keyring } from '@orden/pass/keyring'
import type { Member, VaultRow } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type TestEnv, testEnv } from './harness'
import { aKeyring, anId, pass, passCall, type Person, person, sealed } from './pass-fakes'

let env: TestEnv
let ada: Person
let bob: Person
let api: ReturnType<typeof pass>

const signPub = () => sealed(65)
const signature = () => sealed(64)

function signing(at = 1): Keyring {
  return { ...aKeyring(at), sign: { pub: signPub(), private: sealed(120) } }
}

beforeEach(async () => {
  env = testEnv()
  ada = await person(env, 'ada@example.com')
  bob = await person(env, 'bob@example.com')
  api = pass(env)
})

afterEach(() => env.close())

const vaultOf = async (who: Person, id: string): Promise<VaultRow | undefined> =>
  (await api.changes(who)).vaults.find((one) => one.id === id)

const membersOf = async (who: Person, vault: string) =>
  (await passCall<{ members: Member[] }>(env, who, 'GET', `/vaults/${vault}/members`)).json.members

describe('a keyring’s signing key', () => {
  test('is handed out with the public key, and never changes once set', async () => {
    const older = aKeyring(1)
    expect((await api.keyring(ada, 0, older)).status).toBe(200)
    const signed = { ...older, at: 2, sign: { pub: signPub(), private: sealed(120) } }
    expect((await api.keyring(ada, 1, signed)).status).toBe(200)
    const looked = await passCall(env, bob, 'GET', '/people/key?email=ada@example.com')
    expect(looked.json).toEqual({ pub: older.pub, signPub: signed.sign.pub })

    const swapped = { ...signed, at: 3, sign: { ...signed.sign, pub: signPub() } }
    expect((await api.keyring(ada, 2, swapped)).json.error).toBe('a keyring keeps its signing key')
    const without: Keyring = { ...signed, at: 4 }
    delete without.sign
    expect((await api.keyring(ada, 2, without)).json.error).toBe('a keyring keeps its signing key')
  })
})

describe('a vault’s proofs', () => {
  test('are kept as they are made and come back with the vault', async () => {
    await api.keyring(ada, 0, signing())
    const vault = anId()
    const proof = { by: signPub(), sig: signature(), vouch: null }
    const accepted = { owner: proof.by, sig: signature() }
    const made = await passCall(env, ada, 'PUT', `/vaults/${vault}`, {
      rev: 0,
      meta: sealed(),
      key: sealed(),
      proof,
      accepted,
    })
    expect(made.status).toBe(200)
    expect(await vaultOf(ada, vault)).toMatchObject({ proof, accepted, handovers: [] })

    const junk = await passCall(env, ada, 'PUT', `/vaults/${anId()}`, {
      rev: 0,
      meta: sealed(),
      key: sealed(),
      proof: { by: 'AAAA', sig: signature(), vouch: null },
    })
    expect(junk.status).toBe(400)
  })

  test('are filled in later for a vault made before them, a proof by a manager only', async () => {
    const vault = anId()
    await api.vault(ada, vault)
    await api.invite(ada, vault, bob.email, 'editor')
    await api.accept(bob, vault)
    const proof = { by: signPub(), sig: signature(), vouch: null }
    const trust = (who: Person, body: unknown) =>
      passCall(env, who, 'PUT', `/vaults/${vault}/trust`, body)

    expect((await trust(bob, { proof, keyVersion: 1 })).status).toBe(403)
    expect((await trust(ada, { proof, keyVersion: 2 })).status).toBe(409)
    const accepted = { owner: proof.by, sig: signature() }
    expect((await trust(bob, { accepted })).status).toBe(200)
    expect((await trust(ada, { proof, keyVersion: 1 })).status).toBe(200)
    expect(await vaultOf(bob, vault)).toMatchObject({ proof, accepted })
    expect((await vaultOf(ada, vault))?.accepted).toBeNull()
  })
})

describe('an invitation’s proofs', () => {
  test('carry who invited, what to pin, and the vault key’s proof', async () => {
    const keyring = signing()
    await api.keyring(ada, 0, keyring)
    const vault = anId()
    const proof = { by: keyring.sign!.pub, sig: signature(), vouch: null }
    await passCall(env, ada, 'PUT', `/vaults/${vault}`, {
      rev: 0,
      meta: sealed(),
      key: sealed(),
      proof,
    })
    const pin = { owner: keyring.sign!.pub, vouch: null }
    const vouch = signature()
    const sent = await passCall(env, ada, 'POST', `/vaults/${vault}/invites`, {
      email: bob.email,
      role: 'manager',
      key: sealed(),
      keyVersion: 1,
      vouch,
      pin,
    })
    expect(sent.status).toBe(200)

    const [invite] = (await api.changes(bob)).invites
    expect(invite).toMatchObject({
      keyVersion: 1,
      fromKey: { pub: keyring.pub, signPub: keyring.sign!.pub },
      proof,
      pin,
    })
    const accepted = { owner: pin.owner, sig: signature() }
    expect(
      (await passCall(env, bob, 'POST', `/invites/${vault}/accept`, { accepted })).status,
    ).toBe(200)
    expect((await vaultOf(bob, vault))?.accepted).toEqual(accepted)
    const members = await membersOf(ada, vault)
    expect(members.find((one) => one.email === bob.email)?.vouch).toBe(vouch)

    await passCall(env, ada, 'PUT', `/vaults/${vault}/members/${bob.email}`, { role: 'editor' })
    expect((await membersOf(ada, vault)).find((one) => one.email === bob.email)?.vouch).toBeNull()
    const again = signature()
    await passCall(env, ada, 'PUT', `/vaults/${vault}/members/${bob.email}`, {
      role: 'manager',
      vouch: again,
    })
    expect((await membersOf(ada, vault)).find((one) => one.email === bob.email)?.vouch).toBe(again)
    expect(
      (
        await passCall(env, ada, 'POST', `/vaults/${vault}/invites`, {
          email: 'c@example.com',
          role: 'viewer',
          key: null,
          pin: 'x',
        })
      ).status,
    ).toBe(400)
  })
})

describe('handing a vault on', () => {
  test('keeps the old owner’s signed hand-over, to the heir’s signing key', async () => {
    await api.keyring(ada, 0, signing())
    const heirs = signing()
    await api.keyring(bob, 0, heirs)
    const vault = anId()
    await api.vault(ada, vault)
    await api.invite(ada, vault, bob.email, 'editor')
    await api.accept(bob, vault)
    const sig = signature()
    const handed = await passCall(env, ada, 'PUT', `/vaults/${vault}/owner`, {
      email: bob.email,
      handover: sig,
    })
    expect(handed.status).toBe(200)
    expect((await vaultOf(bob, vault))?.handovers).toEqual([{ to: heirs.sign!.pub, sig }])
    expect(
      (
        await passCall(env, bob, 'PUT', `/vaults/${vault}/owner`, {
          email: ada.email,
          handover: 'x',
        })
      ).status,
    ).toBe(400)
  })
})
