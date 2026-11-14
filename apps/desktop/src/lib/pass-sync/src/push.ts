import {
  openItem,
  openVault,
  sealedRevOf,
  sealItem,
  sealVault,
  sealVersion,
} from '@orden/pass/keys'
import type { Envelope, VaultMeta } from '@orden/pass/types'
import type { ItemRow as WireItem } from '@orden/pass/wire'
import type { ItemRow, KeyringRow, VaultRow, VersionRow } from './local'
import { attachmentsUnder } from './item-keys'
import { mergedEnvelope, mergedFields } from './merge'
import { appliedItems } from './pull'
import type { HeldVault } from './rows'
import { itemOf, vaultOf } from './rows'
import { nothingShown } from './shown'
import type { Answer, Landed } from './sync'
import { currentItem, currentKeyring, currentVault, NO_SUCH_ITEM, ROTATED, STALE } from './sync'
import type { SyncWorld } from './sync-world'
import type { ItemBase } from './synced'
import {
  itemBaseOf,
  keepAccountKeyring,
  keepItemBase,
  keepKeyringBase,
  keepVaultBase,
  keyringBaseOf,
  vaultBaseOf,
} from './synced'

export type Pushed = 'pushed' | 'again' | 'conflict' | 'stuck'

const TRIES = 3

type Sent = 'sent' | 'again' | 'stuck'

function key(vault: string, id: string): string {
  return `${vault}\n${id}`
}

function baseOf(row: WireItem | ItemRow): ItemBase {
  return { rev: row.rev, key: row.key, body: row.body, keyVersion: row.keyVersion }
}

async function pushedKeyring(world: SyncWorld): Promise<Pushed> {
  const { rows, api } = world
  let row = await rows.keyring()
  if (!row?.pending) return 'pushed'
  let rev = await keyringBaseOf(rows)
  for (let tries = 0; tries < TRIES; tries++) {
    const answer = await api.putKeyring(row.keyring, rev)
    if (answer.ok) {
      await settledKeyring(world, row, answer.value.rev)
      return 'pushed'
    }
    if (answer.error !== STALE) return 'stuck'
    const current = currentKeyring(answer)
    if (!current) {
      rev = 0
      continue
    }
    if (current.keyring.pub !== row.keyring.pub) {
      await keepAccountKeyring(rows, current)
      world.conflicted(true)
      return 'conflict'
    }
    if (current.keyring.at >= row.keyring.at) {
      const theirs: KeyringRow = { keyring: current.keyring, rev: current.rev, pending: false }
      await world.exclusive(async () => {
        await rows.writeKeyring(theirs)
        await keepKeyringBase(rows, current.rev)
        world.tookKeyring(theirs)
      })
      return 'pushed'
    }
    rev = current.rev
    row = { ...row, rev }
  }
  return 'stuck'
}

async function settledKeyring(world: SyncWorld, sent: KeyringRow, rev: number): Promise<void> {
  const { rows } = world
  await world.exclusive(async () => {
    await keepKeyringBase(rows, rev)
    await keepAccountKeyring(rows, null)
    world.conflicted(false)
    const now = await rows.keyring()
    if (!now || JSON.stringify(now.keyring) !== JSON.stringify(sent.keyring)) return
    const row = { ...now, rev, pending: false }
    await rows.writeKeyring(row)
    world.tookKeyring(row)
  })
}

async function settledVault(world: SyncWorld, sent: VaultRow, landed: Landed): Promise<void> {
  const { rows } = world
  await world.exclusive(async (held) => {
    await keepVaultBase(rows, sent.id, { rev: landed.rev, meta: sent.meta })
    const now = (await rows.vaults()).find((one) => one.id === sent.id)
    if (!now?.pending || now.deleted || now.meta !== sent.meta) return
    const row = { ...now, rev: landed.rev, pending: false }
    await rows.write({ vaults: [row] })
    const box = held?.vaults.get(row.id)
    if (held && box) held.vaults.set(row.id, { key: box.key, row })
  })
}

async function openedMeta(box: HeldVault, id: string, sealed: string): Promise<VaultMeta | null> {
  try {
    return await openVault(box.key, id, sealed)
  } catch {
    return null
  }
}

async function mergedVault(
  world: SyncWorld,
  sent: VaultRow,
  theirs: { rev: number; meta: string },
): Promise<VaultRow | null> {
  const { rows } = world
  return await world.exclusive(async (held) => {
    const box = held?.vaults.get(sent.id)
    const now = (await rows.vaults()).find((one) => one.id === sent.id)
    if (!held || !box || !now?.pending || now.meta !== sent.meta) return null
    const base = await vaultBaseOf(rows, sent.id)
    const mine = await openedMeta(box, sent.id, now.meta)
    const their = await openedMeta(box, sent.id, theirs.meta)
    if (!mine || !their) return null
    const was = base ? await openedMeta(box, sent.id, base.meta) : null
    const meta = mergedFields(was, mine, their)
    const row = { ...now, rev: theirs.rev + 1, meta: await sealVault(box.key, sent.id, meta) }
    await rows.write({ vaults: [row] })
    await keepVaultBase(rows, sent.id, theirs)
    held.vaults.set(sent.id, { key: box.key, row })
    world.shown({ ...nothingShown(), vaults: [vaultOf(row, meta)] })
    return row
  })
}

async function pushedVault(world: SyncWorld, first: VaultRow): Promise<Sent> {
  const { rows, api } = world
  let row = first
  let rev = (await vaultBaseOf(rows, row.id))?.rev ?? 0
  for (let tries = 0; tries < TRIES; tries++) {
    const answer = await api.putVault(
      row.id,
      rev === 0
        ? {
            rev,
            meta: row.meta,
            key: row.key,
            keyVersion: row.keyVersion,
            proof: row.proof ?? null,
            accepted: row.accepted ?? null,
          }
        : { rev, meta: row.meta },
    )
    if (answer.ok) {
      await settledVault(world, row, answer.value)
      return 'sent'
    }
    if (answer.error !== STALE) return 'stuck'
    const current = currentVault(answer)
    if (!current || current.deleted) return 'again'
    const merged = await mergedVault(world, row, current)
    if (!merged) return 'stuck'
    row = merged
    rev = current.rev
  }
  return 'again'
}

async function settledVaultGone(world: SyncWorld, sent: VaultRow): Promise<void> {
  const { rows } = world
  await world.exclusive(async () => {
    const inside = (await rows.items()).filter((one) => one.vault === sent.id)
    for (const one of inside) await keepItemBase(rows, one.vault, one.id, null)
    await keepVaultBase(rows, sent.id, null)
    await rows.write({
      vaults: [{ ...sent, pending: false }],
      items: inside.filter((one) => one.pending).map((one) => ({ ...one, pending: false })),
    })
  })
}

async function pushedVaultGone(world: SyncWorld, row: VaultRow): Promise<Sent> {
  const base = await vaultBaseOf(world.rows, row.id)
  if (base) {
    const answer =
      row.role === 'owner'
        ? await world.api.deleteVault(row.id)
        : await world.api.leaveVault(row.id, world.email)
    if (!answer.ok && answer.status !== 404) return 'stuck'
  }
  await settledVaultGone(world, row)
  return 'sent'
}

async function settledItem(world: SyncWorld, sent: ItemRow, landed: Landed): Promise<void> {
  const { rows } = world
  await world.exclusive(async (held) => {
    await keepItemBase(rows, sent.vault, sent.id, { ...baseOf(sent), rev: landed.rev })
    const now = await rows.item(sent.vault, sent.id)
    if (!now?.pending || now.body !== sent.body) return
    const row = { ...now, rev: landed.rev, at: landed.at, pending: false }
    await rows.write({ items: [row] })
    const one = held?.items.get(row.id)
    if (held && one?.row.vault === row.vault) held.items.set(row.id, { key: one.key, row })
  })
}

async function settledTombstone(
  world: SyncWorld,
  sent: ItemRow,
  rev: number | null,
): Promise<void> {
  const { rows } = world
  await world.exclusive(async () => {
    await keepItemBase(rows, sent.vault, sent.id, null)
    const now = await rows.item(sent.vault, sent.id)
    if (!now?.pending || !now.deleted) return
    await rows.write({ items: [{ ...now, rev: rev ?? now.rev, pending: false }] })
  })
}

async function opened(
  box: HeldVault,
  row: { vault: string; id: string; key: string; body: string; keyVersion: number },
): Promise<{ envelope: Envelope; itemKey: Uint8Array<ArrayBuffer> } | null> {
  if (row.body === '') return null
  try {
    return await openItem(box.key, row.vault, row.id, row.key, row.body, row.keyVersion)
  } catch {
    return null
  }
}

async function versionOf(
  box: HeldVault,
  row: WireItem | ItemRow,
  rev: number,
  was: { envelope: Envelope; itemKey: Uint8Array<ArrayBuffer> },
): Promise<VersionRow> {
  const sealed = await sealVersion(box.key, row.vault, row.id, rev, was.envelope, was.itemKey)
  return { vault: row.vault, id: row.id, rev, at: row.at, ...sealed }
}

function nextRevOf(rev: number, ...bodies: string[]): number {
  return bodies
    .map((one) => (sealedRevOf(one) ?? 0) + 1)
    .reduce((high, one) => Math.max(high, one), rev)
}

async function mergedItem(
  world: SyncWorld,
  sent: ItemRow,
  current: WireItem,
): Promise<ItemRow | null> {
  const { rows } = world
  return await world.exclusive(async (held) => {
    const box = held?.vaults.get(sent.vault)
    const now = await rows.item(sent.vault, sent.id)
    if (!held || !box || !now?.pending || now.body !== sent.body) return null
    if (current.deleted) {
      await keepItemBase(rows, sent.vault, sent.id, { ...baseOf(current), key: '', body: '' })
      return { ...now, rev: current.rev + 1 }
    }
    const mine = await opened(box, now)
    const theirs = await opened(box, current)
    if (!mine || !theirs) return null
    const base = await itemBaseOf(rows, sent.vault, sent.id)
    const was = base ? await opened(box, { ...sent, ...base }) : null
    const merged = mergedEnvelope(was?.envelope ?? null, mine.envelope, theirs.envelope)
    const envelope = await attachmentsUnder(
      merged.envelope,
      sent.id,
      [mine.itemKey],
      theirs.itemKey,
    )
    const rev = current.rev + 1
    const at = { keyVersion: box.row.keyVersion, rev: nextRevOf(rev, now.body, current.body) }
    const sealed = await sealItem(box.key, sent.vault, sent.id, envelope, at, theirs.itemKey)
    const row: ItemRow = {
      ...now,
      rev,
      key: sealed.key,
      body: sealed.body,
      keyVersion: box.row.keyVersion,
      pending: true,
      deleted: false,
    }
    const versions =
      merged.lost === 'mine'
        ? [await versionOf(box, now, current.rev, mine)]
        : merged.lost === 'theirs'
          ? [await versionOf(box, current, current.rev, theirs)]
          : []
    await rows.write({ items: [row], versions })
    await keepItemBase(rows, sent.vault, sent.id, baseOf(current))
    held.items.set(row.id, { key: theirs.itemKey, row })
    world.shown({ ...nothingShown(), items: [itemOf(row, envelope)] })
    return row
  })
}

async function trashedOf(world: SyncWorld, row: ItemRow): Promise<boolean | undefined> {
  return await world.exclusive(async (held) => {
    const box = held?.vaults.get(row.vault)
    const open = box ? await opened(box, row) : null
    return open ? open.envelope.trashed !== null : undefined
  })
}

async function pushedItem(world: SyncWorld, first: ItemRow): Promise<Sent> {
  const { rows, api } = world
  let row = first
  let rev = (await itemBaseOf(rows, row.vault, row.id))?.rev ?? 0
  for (let tries = 0; tries < TRIES; tries++) {
    const trashed = await trashedOf(world, row)
    const answer = await api.putItem(row.vault, row.id, {
      rev,
      key: row.key,
      body: row.body,
      keyVersion: row.keyVersion,
      ...(trashed === undefined ? {} : { trashed }),
    })
    if (answer.ok) {
      await settledItem(world, row, answer.value)
      return 'sent'
    }
    if (answer.error === ROTATED) return 'again'
    if (answer.error !== STALE) return 'stuck'
    const current = currentItem(answer)
    if (!current) return 'stuck'
    const merged = await mergedItem(world, row, current)
    if (!merged) return 'again'
    row = merged
    rev = current.rev
  }
  return 'again'
}

async function revived(world: SyncWorld, sent: ItemRow, current: WireItem): Promise<void> {
  await world.exclusive(async (held) => {
    const now = await world.rows.item(sent.vault, sent.id)
    if (!now?.pending || !now.deleted) return
    await world.rows.write({ items: [{ ...now, pending: false }] })
    await appliedItems(world, held, [current])
  })
}

async function pushedTombstone(world: SyncWorld, row: ItemRow): Promise<Sent> {
  const base = await itemBaseOf(world.rows, row.vault, row.id)
  if (!base || base.body === '') {
    await settledTombstone(world, row, null)
    return 'sent'
  }
  const answer = await world.api.deleteItem(row.vault, row.id, base.rev)
  if (answer.ok) {
    await settledTombstone(world, row, answer.value.rev)
    return 'sent'
  }
  if (answer.error === NO_SUCH_ITEM) {
    await settledTombstone(world, row, null)
    return 'sent'
  }
  if (answer.error !== STALE) return 'stuck'
  const current = currentItem(answer)
  if (!current || current.deleted) {
    await settledTombstone(world, row, current?.rev ?? null)
    return 'sent'
  }
  await revived(world, row, current)
  return 'sent'
}

async function pushedMove(world: SyncWorld, from: ItemRow, to: ItemRow): Promise<Sent> {
  const base = await itemBaseOf(world.rows, from.vault, from.id)
  if (!base || base.body === '') return await pushedItem(world, to)
  const answer: Answer<Landed> = await world.api.moveItem(from.vault, from.id, {
    to: to.vault,
    rev: base.rev,
    key: to.key,
    body: to.body,
    keyVersion: to.keyVersion,
  })
  if (answer.ok) {
    await settledTombstone(world, from, base.rev + 1)
    await settledItem(world, to, answer.value)
    return 'sent'
  }
  if (answer.error === ROTATED) return 'again'
  const made = await pushedItem(world, to)
  if (made !== 'sent') return made
  return await pushedTombstone(world, from)
}

function worst(a: Sent, b: Sent): Sent {
  if (a === 'stuck' || b === 'stuck') return 'stuck'
  return a === 'again' || b === 'again' ? 'again' : 'sent'
}

async function pushedItems(world: SyncWorld, gone: ReadonlySet<string>): Promise<Sent> {
  const waiting = (await world.rows.items()).filter((one) => one.pending && !gone.has(one.vault))
  const live = new Map(waiting.filter((one) => !one.deleted).map((one) => [one.id, one]))
  const moved = new Set<string>()
  let all: Sent = 'sent'
  for (const row of waiting) {
    if (!row.deleted) continue
    const to = live.get(row.id)
    if (to && to.vault !== row.vault && !(await itemBaseOf(world.rows, to.vault, to.id))) {
      moved.add(key(to.vault, to.id))
      all = worst(all, await pushedMove(world, row, to))
      continue
    }
    all = worst(all, await pushedTombstone(world, row))
  }
  for (const row of live.values()) {
    if (moved.has(key(row.vault, row.id))) continue
    all = worst(all, await pushedItem(world, row))
  }
  return all
}

export async function pushed(world: SyncWorld): Promise<Pushed> {
  const keyring = await pushedKeyring(world)
  if (keyring !== 'pushed') return keyring
  const vaults = (await world.rows.vaults()).filter((one) => one.pending)
  let all: Sent = 'sent'
  for (const row of vaults) {
    all = worst(
      all,
      row.deleted ? await pushedVaultGone(world, row) : await pushedVault(world, row),
    )
  }
  const gone = new Set(vaults.filter((one) => one.deleted).map((one) => one.id))
  all = worst(all, await pushedItems(world, gone))
  if (world.files) all = worst(all, await (await import('./file-sync')).pushedFiles(world))
  return all === 'sent' ? 'pushed' : all
}
