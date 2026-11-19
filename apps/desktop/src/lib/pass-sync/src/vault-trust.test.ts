import { newKey } from '@orden/pass/crypto'
import { newSigner } from '@orden/pass/sign'
import { acceptedOf, keyProofOf } from '@orden/pass/trust'
import type { VaultRow as WireVault } from '@orden/pass/wire'
import { describe, expect, test } from 'vitest'
import type { VaultRow } from './local'
import { keptPin, vaultDistrust } from './vault-trust'

const VAULT = 'vault-1'

async function world() {
  const me = await newSigner()
  const owner = await newSigner()
  const server = await newSigner()
  const first = newKey()
  const accepted = await acceptedOf(me, VAULT, owner.pub)
  const local: VaultRow = {
    id: VAULT,
    rev: 1,
    meta: '',
    key: 'wrapped-first',
    keyVersion: 1,
    role: 'editor',
    owner: '',
    members: 2,
    pending: false,
    deleted: false,
    proof: await keyProofOf(owner, VAULT, 1, first, null),
    accepted,
    handovers: [],
  }
  const wire = (over: Partial<WireVault>): WireVault => ({
    id: VAULT,
    rev: 2,
    meta: '',
    key: 'wrapped-next',
    keyVersion: 2,
    role: 'editor',
    owner: false,
    members: 2,
    deleted: false,
    proof: null,
    handovers: [],
    accepted,
    ...over,
  })
  return { me, owner, server, first, accepted, local, wire }
}

describe('a vault key the account hands over', () => {
  test('is taken when the owner this device pinned proves it', async () => {
    const { me, owner, first, local, wire } = await world()
    const next = newKey()
    const row = wire({ proof: await keyProofOf(owner, VAULT, 2, next, null) })

    expect(await vaultDistrust(me.pub, row, next, local, first)).toBeNull()
  })

  test('is refused when somebody else signed it, even with the pin left off the row', async () => {
    const { me, server, first, local, wire } = await world()
    const next = newKey()
    const proof = await keyProofOf(server, VAULT, 2, next, null)

    expect(await vaultDistrust(me.pub, wire({ proof }), next, local, first)).toBe('unproven')
    expect(await vaultDistrust(me.pub, wire({ proof, accepted: null }), next, local, first)).toBe('unproven')
  })

  test('at the same version and with no key held here needs the owner’s proof', async () => {
    const { me, owner, server, local, wire } = await world()
    const swapped = newKey()
    const forged = wire({
      keyVersion: 1,
      accepted: null,
      proof: await keyProofOf(server, VAULT, 1, swapped, null),
    })
    expect(await vaultDistrust(me.pub, forged, swapped, local, undefined)).toBe('unproven')

    const again = newKey()
    const rewrapped = wire({ keyVersion: 1, proof: await keyProofOf(owner, VAULT, 1, again, null) })
    expect(await vaultDistrust(me.pub, rewrapped, again, local, undefined)).toBeNull()
  })

  test('at the same version is the key held here or swapped', async () => {
    const { me, first, local, wire } = await world()
    expect(await vaultDistrust(me.pub, wire({ keyVersion: 1 }), first, local, first)).toBeNull()
    expect(await vaultDistrust(me.pub, wire({ keyVersion: 1 }), newKey(), local, first)).toBe('swapped')
  })
})

describe('the pin a device keeps', () => {
  test('stays when the account sends the vault without it', async () => {
    const { me, accepted, local, wire } = await world()
    expect(await keptPin(me.pub, wire({ accepted: null }), local)).toEqual(accepted)
  })

  test('is the one the account sends when this device had none', async () => {
    const { me, accepted, local, wire } = await world()
    expect(await keptPin(me.pub, wire({}), { ...local, accepted: null })).toEqual(accepted)
    expect(await keptPin(me.pub, wire({ accepted: null }), undefined)).toBeNull()
  })

  test('is a newer one the reader signed on another device, over the one kept here', async () => {
    const { me, local, wire } = await world()
    const owner = await newSigner()
    const newer = await acceptedOf(me, VAULT, owner.pub)
    expect(await keptPin(me.pub, wire({ accepted: newer }), local)).toEqual(newer)
  })

  test('is never one the reader did not sign, whichever side brings it', async () => {
    const { me, accepted, local, wire, server } = await world()
    const forged = await acceptedOf(server, VAULT, server.pub)
    expect(await keptPin(me.pub, wire({ accepted: forged }), local)).toEqual(accepted)
    expect(await keptPin(me.pub, wire({}), { ...local, accepted: forged })).toEqual(accepted)
  })
})
