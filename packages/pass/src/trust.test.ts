import { describe, expect, it } from 'vitest'
import { newKey, newPair } from './crypto'
import { isSignedBy, newSigner, signatureOf, statementOf } from './sign'
import {
  acceptedOf,
  handoverTo,
  invitedOwnerOf,
  isProven,
  keyProofOf,
  ownersFrom,
  pinnedOwnerOf,
  safetyCodeOf,
  vouchFor,
} from './trust'
import { acceptedIn, handoversIn, keyProofIn, personKeyIn, pinIn } from './wire'

describe('signatures', () => {
  it('verify for the signer and the statement only', async () => {
    const one = await newSigner()
    const two = await newSigner()
    const said = statementOf('test', 'a', 'b')
    const sig = await signatureOf(one, said)
    expect(await isSignedBy(one.pub, said, sig)).toBe(true)
    expect(await isSignedBy(two.pub, said, sig)).toBe(false)
    expect(await isSignedBy(one.pub, statementOf('test', 'a', 'c'), sig)).toBe(false)
    expect(await isSignedBy('AAAA', said, sig)).toBe(false)
    expect(await isSignedBy(one.pub, said, 'not a signature')).toBe(false)
    expect(() => statementOf('test', 'a\nb')).toThrow()
  })
})

describe('a vault key’s proof', () => {
  it('holds when the owner signed it, for that vault, key version and key', async () => {
    const owner = await newSigner()
    const key = newKey()
    const proof = await keyProofOf(owner, 'v1', 2, key, null)
    expect(keyProofIn(JSON.parse(JSON.stringify(proof)))).toEqual(proof)
    expect(await isProven('v1', 2, key, proof, [owner.pub])).toBe(true)
    expect(await isProven('v1', 3, key, proof, [owner.pub])).toBe(false)
    expect(await isProven('v2', 2, key, proof, [owner.pub])).toBe(false)
    expect(await isProven('v1', 2, newKey(), proof, [owner.pub])).toBe(false)
    expect(await isProven('v1', 2, key, null, [owner.pub])).toBe(false)
  })

  it('does not hold when somebody else signed it, the account included', async () => {
    const owner = await newSigner()
    const account = await newSigner()
    const key = newKey()
    const forged = await keyProofOf(account, 'v1', 2, key, null)
    expect(await isProven('v1', 2, key, forged, [owner.pub])).toBe(false)
    const borrowed = { ...(await keyProofOf(owner, 'v1', 2, newKey(), null)), by: owner.pub }
    expect(await isProven('v1', 2, key, borrowed, [owner.pub])).toBe(false)
  })

  it('holds for a manager the owner vouched for, in that vault only', async () => {
    const owner = await newSigner()
    const manager = await newSigner()
    const key = newKey()
    const vouch = await vouchFor(owner, 'v1', manager.pub)
    expect(
      await isProven('v1', 2, key, await keyProofOf(manager, 'v1', 2, key, vouch), [owner.pub]),
    ).toBe(true)
    expect(
      await isProven('v1', 2, key, await keyProofOf(manager, 'v1', 2, key, null), [owner.pub]),
    ).toBe(false)
    const elsewhere = await vouchFor(owner, 'v9', manager.pub)
    expect(
      await isProven('v1', 2, key, await keyProofOf(manager, 'v1', 2, key, elsewhere), [owner.pub]),
    ).toBe(false)
    const self = await vouchFor(manager, 'v1', manager.pub)
    expect(
      await isProven('v1', 2, key, await keyProofOf(manager, 'v1', 2, key, self), [owner.pub]),
    ).toBe(false)
  })
})

describe('owners', () => {
  it('follow the hand-overs each owner signed, from the one pinned', async () => {
    const ada = await newSigner()
    const bob = await newSigner()
    const cy = await newSigner()
    const toBob = await handoverTo(ada, 'v1', bob.pub)
    const toCy = await handoverTo(bob, 'v1', cy.pub)
    expect(handoversIn(JSON.parse(JSON.stringify([toBob, toCy])))).toEqual([toBob, toCy])
    expect(await ownersFrom('v1', ada.pub, [toBob, toCy])).toEqual([ada.pub, bob.pub, cy.pub])
    expect(await ownersFrom('v1', bob.pub, [toBob, toCy])).toEqual([bob.pub, cy.pub])
    expect(await ownersFrom('v2', ada.pub, [toBob])).toEqual([ada.pub])
    const injected = { to: cy.pub, sig: (await handoverTo(cy, 'v1', cy.pub)).sig }
    expect(await ownersFrom('v1', ada.pub, [injected])).toEqual([ada.pub])
  })

  it('are pinned by the reader’s own signature', async () => {
    const me = await newSigner()
    const owner = await newSigner()
    const accepted = await acceptedOf(me, 'v1', owner.pub)
    expect(acceptedIn(JSON.parse(JSON.stringify(accepted)))).toEqual(accepted)
    expect(await pinnedOwnerOf(me.pub, 'v1', accepted)).toBe(owner.pub)
    expect(await pinnedOwnerOf(me.pub, 'v2', accepted)).toBeNull()
    expect(await pinnedOwnerOf(me.pub, 'v1', { ...accepted, owner: me.pub })).toBeNull()
    expect(await pinnedOwnerOf(owner.pub, 'v1', accepted)).toBeNull()
    expect(await pinnedOwnerOf(me.pub, 'v1', null)).toBeNull()
  })

  it('of an invitation are the inviter, or who vouched for them', async () => {
    const owner = await newSigner()
    const manager = await newSigner()
    const pair = await newPair()
    const asOwner = { pub: pair.pub, signPub: owner.pub }
    const asManager = { pub: pair.pub, signPub: manager.pub }
    expect(personKeyIn(asOwner)).toEqual(asOwner)
    const pin = { owner: owner.pub, vouch: null }
    expect(pinIn(pin)).toEqual(pin)
    expect(await invitedOwnerOf('v1', asOwner, pin)).toBe(owner.pub)
    expect(await invitedOwnerOf('v1', asManager, pin)).toBeNull()
    const vouch = await vouchFor(owner, 'v1', manager.pub)
    expect(await invitedOwnerOf('v1', asManager, { owner: owner.pub, vouch })).toBe(owner.pub)
    expect(await invitedOwnerOf('v1', asManager, { owner: manager.pub, vouch })).toBe(manager.pub)
    expect(await invitedOwnerOf('v1', asManager, null)).toBeNull()
  })
})

describe('a safety code', () => {
  it('covers both public keys', async () => {
    const pair = await newPair()
    const one = await newSigner()
    const two = await newSigner()
    const code = await safetyCodeOf({ pub: pair.pub, signPub: one.pub })
    expect(code).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/)
    expect(await safetyCodeOf({ pub: pair.pub, signPub: two.pub })).not.toBe(code)
    expect(await safetyCodeOf({ pub: (await newPair()).pub, signPub: one.pub })).not.toBe(code)
  })
})
