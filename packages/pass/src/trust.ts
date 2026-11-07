import { joined, unbase64 } from './bytes'
import { digestOf, isSignedBy, type Signer, signatureOf, statementOf } from './sign'
import type { Accepted, Handover, KeyProof, PersonKey, Pin } from './wire'

async function keyStatement(
  vault: string,
  keyVersion: number,
  vaultKey: Uint8Array<ArrayBuffer>,
  by: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return statementOf('vault-key', vault, String(keyVersion), await digestOf(vaultKey), by)
}

const vouchStatement = (vault: string, manager: string) => statementOf('vouch', vault, manager)
const handoverStatement = (vault: string, to: string) => statementOf('handover', vault, to)
const acceptedStatement = (vault: string, owner: string) => statementOf('accepted', vault, owner)

export async function keyProofOf(
  signer: Signer,
  vault: string,
  keyVersion: number,
  vaultKey: Uint8Array<ArrayBuffer>,
  vouch: string | null,
): Promise<KeyProof> {
  const sig = await signatureOf(signer, await keyStatement(vault, keyVersion, vaultKey, signer.pub))
  return { by: signer.pub, sig, vouch }
}

export async function vouchFor(owner: Signer, vault: string, manager: string): Promise<string> {
  return await signatureOf(owner, vouchStatement(vault, manager))
}

export async function handoverTo(owner: Signer, vault: string, to: string): Promise<Handover> {
  return { to, sig: await signatureOf(owner, handoverStatement(vault, to)) }
}

export async function acceptedOf(me: Signer, vault: string, owner: string): Promise<Accepted> {
  return { owner, sig: await signatureOf(me, acceptedStatement(vault, owner)) }
}

export async function pinnedOwnerOf(
  me: string,
  vault: string,
  accepted: Accepted | null,
): Promise<string | null> {
  if (accepted === null) return null
  const mine = await isSignedBy(me, acceptedStatement(vault, accepted.owner), accepted.sig)
  return mine ? accepted.owner : null
}

export async function ownersFrom(
  vault: string,
  pinned: string,
  handovers: readonly Handover[],
): Promise<string[]> {
  const owners = [pinned]
  let owner = pinned
  for (const one of handovers) {
    if (!(await isSignedBy(owner, handoverStatement(vault, one.to), one.sig))) continue
    owner = one.to
    if (!owners.includes(owner)) owners.push(owner)
  }
  return owners
}

export async function isVouched(
  vault: string,
  manager: string,
  vouch: string | null,
  owners: readonly string[],
): Promise<boolean> {
  if (owners.includes(manager)) return true
  if (vouch === null) return false
  for (const owner of owners) {
    if (await isSignedBy(owner, vouchStatement(vault, manager), vouch)) return true
  }
  return false
}

export async function isProven(
  vault: string,
  keyVersion: number,
  vaultKey: Uint8Array<ArrayBuffer>,
  proof: KeyProof | null,
  owners: readonly string[],
): Promise<boolean> {
  if (proof === null) return false
  const statement = await keyStatement(vault, keyVersion, vaultKey, proof.by)
  if (!(await isSignedBy(proof.by, statement, proof.sig))) return false
  return await isVouched(vault, proof.by, proof.vouch, owners)
}

export async function invitedOwnerOf(
  vault: string,
  inviter: PersonKey,
  pin: Pin | null,
): Promise<string | null> {
  if (pin === null) return null
  if (pin.owner === inviter.signPub) return pin.owner
  const vouched = await isVouched(vault, inviter.signPub, pin.vouch, [pin.owner])
  return vouched ? pin.owner : null
}

export async function safetyCodeOf(key: PersonKey): Promise<string> {
  const both = joined(unbase64(key.pub), unbase64(key.signPub))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', both))
  const hex = [...digest.slice(0, 16)].map((one) => one.toString(16).padStart(2, '0')).join('')
  return hex.match(/.{4}/g)?.join(' ') ?? hex
}
