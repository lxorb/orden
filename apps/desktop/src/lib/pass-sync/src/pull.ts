import {
  openItem,
  openVault,
  sealedRevOf,
  sealItem,
  sealVersion,
  unwrapVaultKey,
} from '@orden/pass/keys'
import type { Changes, ItemRow as WireItem, VaultRow as WireVault } from '@orden/pass/wire'
import type { Change, ItemRow, VaultRow, VersionRow } from './local'
import { KEPT_AFTER_DELETE } from './local'
import { rekeyed } from './rekey'
import type { Held, HeldVault } from './rows'
import { itemOf, vaultOf } from './rows'
import type { Shown } from './shown'
import { nothingShown, isShown } from './shown'
import type { SyncWorld } from './sync-world'
import type { DeviceRows } from './synced'
import {
  keepAccountKeyring,
  keepInvites,
  keepItemBase,
  keepKeyringBase,
  keepVaultBase,
} from './synced'
import type { TrustReason } from './trust-problem'
import { vaultDistrust } from './vault-trust'

export type Pulled = 'pulled' | 'conflict' | 'deferred'

interface Applying {
  world: SyncWorld
  held: Held | null
  change: Required<Change>
  shown: Shown
  pub: string
  me: string | null
  fresh: string[]
  was: Map<string, Uint8Array<ArrayBuffer>>
}

function distrusted(doing: Applying, vault: string, item: string | null, reason: TrustReason) {
  doing.world.distrusted?.({ vault, item, reason })
}

function isReplayed(local: string, incoming: string): boolean {
  const kept = sealedRevOf(local)
  if (kept === null) return false
  const sent = sealedRevOf(incoming)
  return sent === null || sent < kept
}

function emptyChange(): Required<Change> {
  return { vaults: [], items: [], versions: [], dropVersions: [] }
}

function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function deviceItemOf(row: WireItem): ItemRow {
  return { ...row, pending: false }
}

function deviceVaultOf(row: WireVault, key: string, pub: string): VaultRow {
  return {
    id: row.id,
    rev: row.rev,
    meta: row.meta,
    key,
    keyVersion: row.keyVersion,
    role: row.role,
    owner: row.owner ? pub : '',
    members: row.members,
    pending: false,
    deleted: false,
    proof: row.proof,
    accepted: row.accepted,
    handovers: row.handovers,
  }
}

async function goneVault(doing: Applying, local: VaultRow): Promise<void> {
  const { rows } = doing.world
  doing.change.vaults.push({ ...local, pending: false, deleted: true })
  const inside = (await rows.items()).filter((one) => one.vault === local.id && !one.deleted)
  const at = Date.now()
  for (const one of inside) {
    doing.change.items.push({ ...one, key: '', body: '', at, pending: false, deleted: true })
    doing.change.dropVersions.push(one)
    await keepItemBase(rows, one.vault, one.id, null)
  }
  await keepVaultBase(rows, local.id, null)
  if (doing.held) {
    doing.held.vaults.delete(local.id)
    for (const one of inside) {
      if (doing.held.items.get(one.id)?.row.vault === local.id) doing.held.items.delete(one.id)
    }
  }
  doing.shown.goneVaults.push(local.id)
}

async function resealed(
  rows: DeviceRows,
  vault: string,
  from: Uint8Array<ArrayBuffer>,
  to: HeldVault,
  held: Held,
): Promise<ItemRow[]> {
  const waiting = (await rows.items()).filter(
    (one) =>
      one.vault === vault && one.pending && !one.deleted && one.keyVersion < to.row.keyVersion,
  )
  const made: ItemRow[] = []
  for (const one of waiting) {
    try {
      const opened = await openItem(from, vault, one.id, one.key, one.body, one.keyVersion)
      const { envelope, itemKey } = opened
      const at = { keyVersion: to.row.keyVersion, rev: opened.rev ?? one.rev }
      const sealed = await sealItem(to.key, vault, one.id, envelope, at, itemKey)
      const row = { ...one, key: sealed.key, body: sealed.body, keyVersion: to.row.keyVersion }
      held.items.set(one.id, { key: itemKey, row })
      made.push(row)
    } catch {
      continue
    }
  }
  return made
}

async function versionsRekeyed(
  rows: DeviceRows,
  vault: string,
  from: Uint8Array<ArrayBuffer>,
  to: Uint8Array<ArrayBuffer>,
): Promise<VersionRow[]> {
  const inside = (await rows.items()).filter((one) => one.vault === vault && !one.deleted)
  const made: VersionRow[] = []
  for (const one of inside) {
    for (const version of await rows.versions(vault, one.id)) {
      const key = await rekeyed([from], to, vault, one.id, version.key)
      if (key !== null) made.push({ ...version, key })
    }
  }
  return made
}

async function appliedVault(
  doing: Applying,
  row: WireVault,
  local: VaultRow | undefined,
): Promise<Pulled> {
  const { rows } = doing.world
  if (row.deleted) {
    if (local && !(local.deleted && !local.pending)) await goneVault(doing, local)
    return 'pulled'
  }
  if (local?.pending || row.key === null) return 'pulled'
  if (local && row.keyVersion < local.keyVersion) {
    distrusted(doing, row.id, null, 'older')
    return 'pulled'
  }
  const renewed = local?.keyVersion !== row.keyVersion || row.key !== local.key
  const rotated = local !== undefined && row.keyVersion > local.keyVersion
  const held = doing.held
  if (renewed && !held) return 'deferred'
  const before = held?.vaults.get(row.id)
  let key: Uint8Array<ArrayBuffer> | null = null
  if (held) {
    try {
      key = await unwrapVaultKey(row.key, held.opened.pair, row.id)
    } catch {
      key = null
    }
    if (key === null && renewed) {
      distrusted(doing, row.id, null, local ? 'swapped' : 'unasked')
      return 'pulled'
    }
    const problem =
      key !== null && renewed ? await vaultDistrust(doing.me, row, key, local, before?.key) : null
    if (problem) {
      distrusted(doing, row.id, null, problem)
      return 'pulled'
    }
  }
  const next = deviceVaultOf(row, row.key, doing.pub)
  doing.change.vaults.push(next)
  await keepVaultBase(rows, row.id, { rev: row.rev, meta: row.meta })
  if (!local) doing.fresh.push(row.id)
  if (!held) return 'pulled'
  try {
    if (key === null) throw new Error('pass: the vault key could not be opened')
    const meta = await openVault(key, row.id, row.meta)
    const box = { key, row: next }
    held.vaults.set(row.id, box)
    doing.shown.vaults.push(vaultOf(next, meta))
    if (rotated && before) {
      doing.was.set(row.id, before.key)
      doing.change.items.push(...(await resealed(rows, row.id, before.key, box, held)))
      doing.change.versions.push(...(await versionsRekeyed(rows, row.id, before.key, key)))
    }
  } catch {
    held.vaults.delete(row.id)
  }
  return 'pulled'
}

async function versionOfOld(
  doing: Applying,
  held: Held,
  local: ItemRow,
  row: WireItem,
): Promise<VersionRow[]> {
  const box = held.vaults.get(local.vault)
  if (!box || local.deleted || local.rev === row.rev) return []
  const old = doing.was.get(local.vault)
  const keys = old ? [box.key, old] : [box.key]
  const key = await rekeyed(keys, box.key, local.vault, local.id, local.key)
  if (key === null) return []
  try {
    const was = await openItem(box.key, local.vault, local.id, key, local.body, local.keyVersion)
    const now = await openItem(box.key, row.vault, row.id, row.key, row.body, row.keyVersion)
    if (sameContent(was.envelope.content, now.envelope.content)) return []
    const { vault, id, rev, at } = local
    const sealed = await sealVersion(box.key, vault, id, rev, was.envelope, was.itemKey)
    return [{ vault, id, rev, at, ...sealed }]
  } catch {
    return []
  }
}

async function lastVersionOf(held: Held | null, local: ItemRow): Promise<VersionRow[]> {
  const box = held?.vaults.get(local.vault)
  if (!box || local.body === '') return []
  try {
    const { vault, id, rev, at } = local
    const was = await openItem(box.key, vault, id, local.key, local.body, local.keyVersion)
    const sealed = await sealVersion(box.key, vault, id, rev, was.envelope, was.itemKey)
    return [{ vault, id, rev, at, ...sealed }]
  } catch {
    return []
  }
}

async function forgottenHistory(doing: Applying): Promise<void> {
  const { rows } = doing.world
  const before = Date.now() - KEPT_AFTER_DELETE
  for (const one of await rows.items()) {
    if (!one.deleted || one.pending || one.at >= before) continue
    if ((await rows.versions(one.vault, one.id)).length) doing.change.dropVersions.push(one)
  }
}

async function appliedItem(doing: Applying, row: WireItem): Promise<void> {
  const { rows } = doing.world
  const local = await rows.item(row.vault, row.id)
  if (local?.pending) return
  const held = doing.held
  if (local && !local.deleted && !row.deleted && isReplayed(local.body, row.body)) {
    distrusted(doing, row.vault, row.id, 'replayed')
    return
  }
  if (row.deleted) {
    if (!local || local.deleted) return
    doing.change.versions.push(...(await lastVersionOf(held, local)))
    doing.change.items.push({
      ...local,
      rev: row.rev,
      key: '',
      body: '',
      at: Date.now(),
      pending: false,
      deleted: true,
    })
    await keepItemBase(rows, row.vault, row.id, null)
    if (held?.items.get(row.id)?.row.vault === row.vault) held.items.delete(row.id)
    doing.shown.goneItems.push({ vault: row.vault, id: row.id })
    return
  }
  const next = deviceItemOf(row)
  if (local && held) doing.change.versions.push(...(await versionOfOld(doing, held, local, row)))
  doing.change.items.push(next)
  await keepItemBase(rows, row.vault, row.id, {
    rev: row.rev,
    key: row.key,
    body: row.body,
    keyVersion: row.keyVersion,
  })
  const box = held?.vaults.get(row.vault)
  if (!held || !box) return
  try {
    const { envelope, itemKey } = await openItem(
      box.key,
      row.vault,
      row.id,
      row.key,
      row.body,
      row.keyVersion,
    )
    held.items.set(row.id, { key: itemKey, row: next })
    doing.shown.items.push(itemOf(next, envelope))
  } catch {
    return
  }
}

async function appliedKeyring(doing: Applying, changes: Changes): Promise<Pulled> {
  const { world } = doing
  const theirs = changes.keyring
  if (!theirs) return 'pulled'
  const local = await world.rows.keyring()
  if (local && local.keyring.pub !== theirs.keyring.pub) {
    await keepAccountKeyring(world.rows, theirs)
    world.conflicted(true)
    return 'conflict'
  }
  if (local?.pending) return 'pulled'
  const signing = local?.keyring.sign?.pub
  if (signing !== undefined && theirs.keyring.sign?.pub !== signing) return 'pulled'
  const row = { keyring: theirs.keyring, rev: theirs.rev, pending: false }
  await world.rows.writeKeyring(row)
  await keepKeyringBase(world.rows, theirs.rev)
  world.tookKeyring(row)
  doing.pub = theirs.keyring.pub
  return 'pulled'
}

async function finished(doing: Applying): Promise<void> {
  await doing.world.rows.write(doing.change)
  if (isShown(doing.shown)) doing.world.shown(doing.shown)
}

export async function appliedChanges(
  world: SyncWorld,
  held: Held | null,
  changes: Changes,
  since: number,
): Promise<{ pulled: Pulled; fresh: string[] }> {
  const keyring = await world.rows.keyring()
  const doing: Applying = {
    world,
    held,
    change: emptyChange(),
    shown: nothingShown(),
    pub: keyring?.keyring.pub ?? '',
    me: held?.opened.signer?.pub ?? null,
    fresh: [],
    was: new Map(),
  }
  const took = await appliedKeyring(doing, changes)
  if (took !== 'pulled') return { pulled: took, fresh: [] }
  const vaults = new Map((await world.rows.vaults()).map((one) => [one.id, one]))
  for (const row of changes.vaults) {
    const done = await appliedVault(doing, row, vaults.get(row.id))
    if (done !== 'pulled') return { pulled: done, fresh: [] }
  }
  for (const row of changes.items) await appliedItem(doing, row)
  await forgottenHistory(doing)
  await finished(doing)
  if (world.files) await (await import('./file-sync')).forgottenFiles(world, changes.items)
  await keepInvites(world.rows, changes.invites)
  world.invited(changes.invites)
  return { pulled: 'pulled', fresh: since > 0 ? doing.fresh : [] }
}

export async function appliedItems(
  world: SyncWorld,
  held: Held | null,
  items: readonly WireItem[],
): Promise<void> {
  const keyring = await world.rows.keyring()
  const doing: Applying = {
    world,
    held,
    change: emptyChange(),
    shown: nothingShown(),
    pub: keyring?.keyring.pub ?? '',
    me: held?.opened.signer?.pub ?? null,
    fresh: [],
    was: new Map(),
  }
  for (const row of items) await appliedItem(doing, row)
  await finished(doing)
}
