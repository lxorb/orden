import { newKey } from '@orden/pass/crypto'
import {
  openItem,
  openVault,
  openVersion,
  sealItem,
  sealVault,
  sealVersion,
  unwrapVaultKey,
  wrapVaultKey,
} from '@orden/pass/keys'
import type { Signer } from '@orden/pass/sign'
import {
  acceptedOf,
  handoverTo,
  invitedOwnerOf,
  isProven,
  isVouched,
  keyProofOf,
  pinnedOwnerOf,
  vouchFor,
} from '@orden/pass/trust'
import type { Role, VaultMeta } from '@orden/pass/types'
import type { Invite, Member, MemberState, VaultRow as WireVault } from '@orden/pass/wire'
import { vaultRowIn } from '@orden/pass/wire'
import { attachmentsUnder } from './item-keys'
import type { ItemRow, VaultRow, VersionRow } from './local'
import type { Person, PersonKey } from './people'
import { isConfirmed, PersonChanged, personOf, seenPerson } from './people'
import type { Held, HeldVault } from './rows'
import type { Resealed, Rotation, ShareApi } from './share-api'
import { refusalOf } from './share-api'
import { STALE } from './sync'
import type { DeviceRows } from './synced'
import { keepItemBase, keepVaultBase, vaultBaseOf } from './synced'
import { ownersOf } from './vault-trust'

export interface Sharing {
  api: ShareApi
  held: Held
  rows: DeviceRows
  email: string
  versions(vault: string, id: string): Promise<VersionRow[]>
}

export type InvitedRole = Exclude<Role, 'owner'>

interface KeyAt {
  key: Uint8Array<ArrayBuffer>
  rev: number
  keyVersion: number
  meta: string
}

interface SealedRow {
  vault: string
  id: string
  rev: number
  key: string
  body: string
  keyVersion: number
}

interface Renewed {
  itemKey: Uint8Array<ArrayBuffer>
  sent: Resealed
}

interface Rotated extends KeyAt {
  wrapped: string
  proof: Rotation['proof']
  renewed: Map<string, Renewed>
}

const TRIES = 3
const NOT_EVERYONE = 'a new key covers every member and every item'

class NotTrusted extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotTrusted'
  }
}

export function emailOf(email: string): string {
  return email.trim().toLowerCase()
}

function boxOf(held: Held, vault: string): HeldVault {
  const box = held.vaults.get(vault)
  if (!box) throw new Error('pass: no such vault')
  return box
}

function signerOf(held: Held): Signer {
  if (!held.opened.signer) throw new NotTrusted('Pass has no signing key yet. Lock and unlock it.')
  return held.opened.signer
}

function keyOf(member: Member): PersonKey | null {
  return member.pub === null ? null : { pub: member.pub, signPub: member.signPub }
}

export async function personFor(sharing: Sharing, email: string): Promise<Person> {
  const to = emailOf(email)
  return await personOf(sharing.rows, to, await sharing.api.personKey(to))
}

export async function memberPerson(sharing: Sharing, member: Member): Promise<Person> {
  return await personOf(sharing.rows, member.email, keyOf(member))
}

async function ownersHeld(sharing: Sharing, vault: string): Promise<string[]> {
  return await ownersOf(signerOf(sharing.held).pub, vault, boxOf(sharing.held, vault).row)
}

async function vouchOf(
  sharing: Sharing,
  vault: string,
  owners: readonly string[],
  members: readonly Member[],
): Promise<string | null> {
  const me = signerOf(sharing.held).pub
  if (owners.includes(me)) return null
  const vouch = members.find((one) => one.email === sharing.email)?.vouch ?? null
  if (vouch !== null && (await isVouched(vault, me, vouch, owners))) return vouch
  throw new NotTrusted('Only the owner, or a manager the owner made, can do that.')
}

export async function invitedMeta(held: Held, invite: Invite): Promise<VaultMeta | null> {
  if (invite.key === null) return null
  try {
    const key = await unwrapVaultKey(invite.key, held.opened.pair, invite.vault)
    return await openVault(key, invite.vault, invite.meta)
  } catch {
    return null
  }
}

async function readyKey(sharing: Sharing, person: Person): Promise<PersonKey | null> {
  if (person.key === null) return null
  if (person.known === 'changed') throw new PersonChanged(person.email)
  return (await isConfirmed(sharing.rows, person.email, person.key)) ? person.key : null
}

export async function invitedState(
  sharing: Sharing,
  vault: string,
  person: Person,
  role: InvitedRole,
): Promise<MemberState> {
  const box = boxOf(sharing.held, vault)
  const signer = signerOf(sharing.held)
  const owners = await ownersHeld(sharing, vault)
  const mine = await vouchOf(sharing, vault, owners, await sharing.api.members(vault))
  const key = await readyKey(sharing, person)
  const owning = owners.includes(signer.pub)
  const heir = person.key?.signPub ?? null
  return await sharing.api.invite(vault, {
    email: person.email,
    role,
    key: key === null ? null : await wrapVaultKey(box.key, key.pub, vault),
    keyVersion: box.row.keyVersion,
    vouch:
      role === 'manager' && owning && heir !== null ? await vouchFor(signer, vault, heir) : null,
    pin: {
      owner: owning ? signer.pub : await voucherOf(vault, signer.pub, mine, owners),
      vouch: mine,
    },
  })
}

async function voucherOf(
  vault: string,
  me: string,
  vouch: string | null,
  owners: readonly string[],
): Promise<string> {
  for (const owner of owners) {
    if (await isVouched(vault, me, vouch, [owner])) return owner
  }
  throw new NotTrusted('Only the owner, or a manager the owner made, can do that.')
}

export async function confirmedMember(
  sharing: Sharing,
  vault: string,
  person: Person,
): Promise<void> {
  const box = boxOf(sharing.held, vault)
  const member = (await sharing.api.members(vault)).find((one) => one.email === person.email)
  if (!member || member.state === 'active') throw new Error('pass: no such invitation')
  const key = await readyKey(sharing, person)
  if (key === null) throw new Error('Check their safety code with them first.')
  if (member.pub !== key.pub) throw new PersonChanged(person.email)
  const wrapped = await wrapVaultKey(box.key, key.pub, vault)
  await sharing.api.giveKey(vault, person.email, wrapped, box.row.keyVersion)
}

export async function roleGiven(
  sharing: Sharing,
  vault: string,
  email: string,
  role: InvitedRole,
): Promise<void> {
  const to = emailOf(email)
  const signer = signerOf(sharing.held)
  const owners = await ownersHeld(sharing, vault)
  let vouch: string | null = null
  if (role === 'manager' && owners.includes(signer.pub)) {
    const member = (await sharing.api.members(vault)).find((one) => one.email === to)
    const key = member ? keyOf(member) : null
    if (key?.signPub) {
      if ((await seenPerson(sharing.rows, to, key)) === 'changed') throw new PersonChanged(to)
      vouch = await vouchFor(signer, vault, key.signPub)
    }
  }
  await sharing.api.setRole(vault, to, role, vouch)
}

export async function handedOn(sharing: Sharing, vault: string, email: string): Promise<void> {
  const to = emailOf(email)
  const signer = signerOf(sharing.held)
  const member = (await sharing.api.members(vault)).find((one) => one.email === to)
  const key = member ? keyOf(member) : null
  if (!key?.signPub) throw new Error('They need to open Pass once more before they can own it.')
  if ((await seenPerson(sharing.rows, to, key)) === 'changed') throw new PersonChanged(to)
  const handover = await handoverTo(signer, vault, key.signPub)
  await sharing.api.setOwner(vault, to, handover.sig)
}

export async function acceptedInvite(sharing: Sharing, invite: Invite): Promise<void> {
  const signer = signerOf(sharing.held)
  const from = invite.fromKey
  if (invite.key === null || from === null) {
    throw new NotTrusted('This invitation cannot be checked. Ask them to invite you again.')
  }
  if ((await seenPerson(sharing.rows, emailOf(invite.from), from)) === 'changed') {
    throw new PersonChanged(invite.from)
  }
  const owner = await invitedOwnerOf(invite.vault, from, invite.pin)
  const key = await unwrapVaultKey(invite.key, sharing.held.opened.pair, invite.vault)
  if (
    owner === null ||
    !(await isProven(invite.vault, invite.keyVersion, key, invite.proof, [owner]))
  ) {
    throw new NotTrusted('This invitation is not signed by the vault’s owner. Pass left it out.')
  }
  await sharing.api.accept(invite.vault, await acceptedOf(signer, invite.vault, owner))
}

function currentOf(body: unknown): WireVault | null {
  if (typeof body !== 'object' || body === null) return null
  return vaultRowIn((body as { current?: unknown }).current)
}

async function startOf(sharing: Sharing, vault: string): Promise<KeyAt> {
  const box = boxOf(sharing.held, vault)
  const base = await vaultBaseOf(sharing.rows, vault)
  return {
    key: box.key,
    rev: base?.rev ?? box.row.rev,
    keyVersion: box.row.keyVersion,
    meta: base?.meta ?? box.row.meta,
  }
}

async function startFrom(sharing: Sharing, current: WireVault): Promise<KeyAt> {
  if (current.key === null || current.deleted) throw new Error('pass: no such vault')
  return {
    key: await unwrapVaultKey(current.key, sharing.held.opened.pair, current.id),
    rev: current.rev,
    keyVersion: current.keyVersion,
    meta: current.meta,
  }
}

async function wrappedToEveryone(
  sharing: Sharing,
  vault: string,
  members: readonly Member[],
  owners: readonly string[],
  next: Uint8Array<ArrayBuffer>,
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {}
  for (const member of members) {
    if (member.email === sharing.email) {
      keys[member.email] = await wrapVaultKey(next, sharing.held.opened.pair.pub, vault)
      continue
    }
    if (member.state === 'confirm') continue
    const key = keyOf(member)
    if (key === null) {
      if (member.state === 'pending') continue
      throw new Error('pass: a member has no key to share with')
    }
    if ((await seenPerson(sharing.rows, member.email, key)) === 'changed') {
      const owning =
        member.role === 'owner' || (key.signPub !== null && owners.includes(key.signPub))
      if (owning) throw new PersonChanged(member.email)
      continue
    }
    keys[member.email] = await wrapVaultKey(next, key.pub, vault)
  }
  return keys
}

async function renewedItem(
  row: SealedRow,
  from: readonly Uint8Array<ArrayBuffer>[],
  to: Uint8Array<ArrayBuffer>,
  keyVersion: number,
  itemKey: Uint8Array<ArrayBuffer>,
): Promise<{ key: string; body: string; itemKey: Uint8Array<ArrayBuffer> }> {
  for (const key of from) {
    let opened: Awaited<ReturnType<typeof openItem>>
    try {
      opened = await openItem(key, row.vault, row.id, row.key, row.body, row.keyVersion)
    } catch {
      continue
    }
    const envelope = await attachmentsUnder(opened.envelope, row.id, [opened.itemKey], itemKey)
    const at = { keyVersion, rev: opened.rev ?? row.rev }
    return await sealItem(to, row.vault, row.id, envelope, at, itemKey)
  }
  throw new Error('pass: an item in the vault could not be opened')
}

async function rotationOf(
  sharing: Sharing,
  vault: string,
  from: KeyAt,
  next: Uint8Array<ArrayBuffer>,
): Promise<{ sent: Rotation; renewed: Map<string, Renewed> }> {
  const [members, rows] = await Promise.all([
    sharing.api.members(vault),
    sharing.api.allVaultItems(vault),
  ])
  const owners = await ownersHeld(sharing, vault)
  const vouch = await vouchOf(sharing, vault, owners, members)
  const keyVersion = from.keyVersion + 1
  const items: Record<string, Resealed> = {}
  const renewed = new Map<string, Renewed>()
  for (const row of rows) {
    if (row.deleted) continue
    const itemKey = newKey()
    const sealed = await renewedItem(row, [from.key], next, keyVersion, itemKey)
    const sent = { key: sealed.key, body: sealed.body, rev: row.rev }
    items[row.id] = sent
    renewed.set(row.id, { itemKey, sent })
  }
  const meta = await sealVault(next, vault, await openVault(from.key, vault, from.meta))
  const signer = signerOf(sharing.held)
  return {
    sent: {
      rev: from.rev,
      keyVersion,
      meta,
      members: await wrappedToEveryone(sharing, vault, members, owners, next),
      items,
      proof: await keyProofOf(signer, vault, keyVersion, next, vouch),
    },
    renewed,
  }
}

async function versionsRenewed(
  sharing: Sharing,
  one: ItemRow,
  from: readonly Uint8Array<ArrayBuffer>[],
  to: Uint8Array<ArrayBuffer>,
  itemKey: Uint8Array<ArrayBuffer>,
): Promise<VersionRow[]> {
  const kept: VersionRow[] = []
  for (const version of await sharing.versions(one.vault, one.id)) {
    for (const key of from) {
      try {
        const was = await openVersion(
          key,
          one.vault,
          one.id,
          version.rev,
          version.key,
          version.body,
        )
        const envelope = await attachmentsUnder(was.envelope, one.id, [was.itemKey], itemKey)
        const sealed = await sealVersion(to, one.vault, one.id, version.rev, envelope, itemKey)
        kept.push({ ...version, ...sealed })
        break
      } catch {
        continue
      }
    }
  }
  return kept
}

async function itemRenewedLocally(
  sharing: Sharing,
  one: ItemRow,
  from: readonly Uint8Array<ArrayBuffer>[],
  now: Rotated,
): Promise<{ row: ItemRow; itemKey: Uint8Array<ArrayBuffer> } | null> {
  const { rows } = sharing
  const theirs = now.renewed.get(one.id)
  const keyVersion = now.keyVersion
  const base = theirs ? { ...theirs.sent, rev: theirs.sent.rev + 1, keyVersion } : null
  if (base) await keepItemBase(rows, one.vault, one.id, base)
  if (!one.pending && theirs && base) {
    return { row: { ...one, ...base }, itemKey: theirs.itemKey }
  }
  const itemKey = theirs?.itemKey ?? newKey()
  try {
    const sealed = await renewedItem(one, from, now.key, keyVersion, itemKey)
    const rev = base ? base.rev + 1 : one.rev
    return { row: { ...one, key: sealed.key, body: sealed.body, keyVersion, rev }, itemKey }
  } catch {
    return null
  }
}

async function rekeyedLocally(
  sharing: Sharing,
  vault: string,
  was: KeyAt,
  now: Rotated,
): Promise<void> {
  const { held, rows } = sharing
  const box = boxOf(held, vault)
  const from = box.key === was.key ? [box.key] : [box.key, was.key]
  const renewedRow = {
    key: now.wrapped,
    keyVersion: now.keyVersion,
    proof: now.proof,
  }
  const row: VaultRow = box.row.pending
    ? {
        ...box.row,
        ...renewedRow,
        meta: await sealVault(now.key, vault, await openVault(box.key, vault, box.row.meta)),
      }
    : { ...box.row, ...renewedRow, rev: now.rev, meta: now.meta }
  const inside = (await rows.items()).filter(
    (one) => one.vault === vault && !one.deleted && one.key !== '',
  )
  const items: ItemRow[] = []
  const versions: VersionRow[] = []
  const keys = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const one of inside) {
    const made = await itemRenewedLocally(sharing, one, from, now)
    if (!made) continue
    items.push(made.row)
    keys.set(one.id, made.itemKey)
    versions.push(...(await versionsRenewed(sharing, one, from, now.key, made.itemKey)))
  }
  await rows.write({ vaults: [row], items, versions, dropVersions: inside })
  await keepVaultBase(rows, vault, { rev: now.rev, meta: now.meta })
  held.vaults.set(vault, { key: now.key, row })
  for (const one of items) {
    const kept = held.items.get(one.id)
    const key = keys.get(one.id)
    if (kept?.row.vault === vault && key) held.items.set(one.id, { key, row: one })
  }
}

async function rotatedVault(sharing: Sharing, vault: string): Promise<number> {
  let from = await startOf(sharing, vault)
  for (let tries = 0; tries < TRIES; tries++) {
    const next = newKey()
    const { sent, renewed } = await rotationOf(sharing, vault, from, next)
    const wrapped = await wrapVaultKey(next, sharing.held.opened.pair.pub, vault)
    try {
      const done = await sharing.api.rotate(vault, sent)
      await rekeyedLocally(sharing, vault, from, {
        key: next,
        rev: done.rev,
        keyVersion: done.keyVersion,
        meta: sent.meta,
        wrapped,
        proof: sent.proof,
        renewed,
      })
      return done.keyVersion
    } catch (error) {
      const said = refusalOf(error)
      if (said?.error === NOT_EVERYONE) continue
      if (said?.error !== STALE) throw error
      const current = currentOf(said.body)
      if (current === null) throw error
      from = await startFrom(sharing, current)
    }
  }
  throw new Error('pass: the vault kept changing while its key was renewed')
}

export async function removedMember(
  sharing: Sharing,
  vault: string,
  email: string,
): Promise<number> {
  const owners = await ownersHeld(sharing, vault)
  await vouchOf(sharing, vault, owners, await sharing.api.members(vault))
  try {
    await sharing.api.removeMember(vault, emailOf(email))
  } catch (error) {
    if (refusalOf(error)?.error !== 'no such member') throw error
  }
  return await rotatedVault(sharing, vault)
}

async function ownerOfMembers(sharing: Sharing, vault: string): Promise<string | null> {
  const owner = (await sharing.api.members(vault)).find((one) => one.role === 'owner')
  const key = owner ? keyOf(owner) : null
  if (!owner || !key?.signPub) return null
  return (await seenPerson(sharing.rows, owner.email, key)) === 'changed' ? null : key.signPub
}

async function backfilledVault(sharing: Sharing, vault: string, box: HeldVault): Promise<boolean> {
  const signer = signerOf(sharing.held)
  const { row } = box
  const pinned = await pinnedOwnerOf(signer.pub, vault, row.accepted ?? null)
  const owning = row.role === 'owner'
  const proven =
    !owning || (await isProven(vault, row.keyVersion, box.key, row.proof ?? null, [signer.pub]))
  if (pinned !== null && proven) return false
  const owner = owning ? signer.pub : (pinned ?? (await ownerOfMembers(sharing, vault)))
  if (owner === null) return false
  await sharing.api.trust(vault, {
    ...(pinned === null ? { accepted: await acceptedOf(signer, vault, owner) } : {}),
    ...(proven
      ? {}
      : {
          proof: await keyProofOf(signer, vault, row.keyVersion, box.key, null),
          keyVersion: row.keyVersion,
        }),
  })
  return true
}

export async function trustBackfilled(sharing: Sharing): Promise<number> {
  let done = 0
  for (const [vault, box] of sharing.held.vaults) {
    if (box.row.pending) continue
    if (await backfilledVault(sharing, vault, box)) done++
  }
  return done
}
