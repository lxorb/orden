import type { Opened } from '@orden/pass/keys'
import { newKey } from '@orden/pass/crypto'
import {
  openItem,
  openVault,
  openVersion,
  sealedRevOf,
  sealItem,
  sealVersion,
  unwrapVaultKey,
} from '@orden/pass/keys'
import type { Content, Envelope, Folder, Item, Vault, VaultMeta } from '@orden/pass/types'
import { log } from '../platform/src/api'
import { attachmentsUnder } from './item-keys'
import type { Change, ItemRow, VaultRow, VersionRow } from './local'
import { readItem, readItems, readVaults, readVersions } from './local'

export interface HeldVault {
  key: Uint8Array<ArrayBuffer>
  row: VaultRow
}

interface HeldItem {
  key: Uint8Array<ArrayBuffer>
  row: ItemRow
}

export interface Held {
  opened: Opened
  vaults: Map<string, HeldVault>
  items: Map<string, HeldItem>
}

export interface Put {
  vault: string
  id: string
  envelope: Envelope
  fresh?: true
}

export interface Sealed {
  change: Change
  held: HeldItem[]
  made: Item[]
}

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function emptyHeld(opened: Opened): Held {
  return { opened, vaults: new Map(), items: new Map() }
}

export function vaultOf(row: VaultRow, meta: VaultMeta): Vault {
  return {
    ...meta,
    id: row.id,
    rev: row.rev,
    role: row.role,
    members: row.members,
    shared: row.members > 1,
  }
}

export function metaOf(vault: Vault): VaultMeta {
  return {
    v: 1,
    name: vault.name,
    description: vault.description,
    color: vault.color,
    icon: vault.icon,
    ...(vault.mark ? { mark: vault.mark } : {}),
    folders: vault.folders,
    hidePasswordsFromViewers: vault.hidePasswordsFromViewers,
  }
}

export function itemOf(row: { vault: string; id: string; rev: number }, envelope: Envelope): Item {
  return { ...envelope, id: row.id, vault: row.vault, rev: row.rev }
}

export function envelopeOf(item: Item): Envelope {
  return {
    v: 1,
    content: item.content,
    folder: item.folder,
    trashed: item.trashed,
    pinned: item.pinned,
    monitored: item.monitored,
    attachments: item.attachments,
    created: item.created,
    modified: item.modified,
    used: item.used,
  }
}

function sameContent(a: Content, b: Content): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function tombstoneOf(row: ItemRow, at: number): ItemRow {
  return { ...row, rev: row.rev + 1, key: '', body: '', at, pending: true, deleted: true }
}

export function withMade(items: readonly Item[], made: readonly Item[]): Item[] {
  const byId = new Map(made.map((item) => [item.id, item]))
  const known = new Set(items.map((item) => item.id))
  return [
    ...items.map((item) => byId.get(item.id) ?? item),
    ...made.filter((item) => !known.has(item.id)),
  ]
}

export function without(items: readonly Item[], ids: Iterable<string>): Item[] {
  const gone = new Set(ids)
  return items.filter((item) => !gone.has(item.id))
}

export function folderFor(folders: Folder[], path: string | null): string | null {
  if (path === null) return null
  let parent: string | null = null
  for (const name of path.split('/').map((one) => one.trim())) {
    if (name === '') continue
    const under: string | null = parent
    const found: Folder | undefined = folders.find(
      (one) => one.parent === under && one.name === name,
    )
    const folder: Folder = found ?? { id: newId(), name, parent: under }
    if (!found) folders.push(folder)
    parent = folder.id
  }
  return parent
}

export async function openAll(
  opened: Opened,
): Promise<{ held: Held; vaults: Vault[]; items: Item[] }> {
  const held = emptyHeld(opened)
  const [vaultRows, itemRows] = await Promise.all([readVaults(), readItems()])
  const vaults: Vault[] = []
  for (const row of vaultRows) {
    if (row.deleted) continue
    try {
      const key = await unwrapVaultKey(row.key, opened.pair, row.id)
      vaults.push(vaultOf(row, await openVault(key, row.id, row.meta)))
      held.vaults.set(row.id, { key, row })
    } catch {
      log('warn', 'pass: a vault on this device could not be opened')
    }
  }
  const items: Item[] = []
  await Promise.all(
    itemRows.map(async (row) => {
      const box = held.vaults.get(row.vault)
      if (row.deleted || !box) return
      try {
        const { envelope, itemKey } = await openItem(
          box.key,
          row.vault,
          row.id,
          row.key,
          row.body,
          row.keyVersion,
        )
        held.items.set(row.id, { key: itemKey, row })
        items.push(itemOf(row, envelope))
      } catch {
        log('warn', 'pass: an item on this device could not be opened')
      }
    }),
  )
  return { held, vaults, items }
}

export async function openVersions(box: HeldVault, vault: string, id: string): Promise<Item[]> {
  const rows = await readVersions(vault, id)
  const opened = await Promise.all(
    rows.map(async (row) => {
      try {
        const { envelope } = await openVersion(
          box.key,
          row.vault,
          row.id,
          row.rev,
          row.key,
          row.body,
        )
        return [itemOf(row, envelope)]
      } catch {
        return []
      }
    }),
  )
  return opened.flat()
}

async function movedVersions(
  from: HeldVault,
  to: HeldVault,
  was: ItemRow,
  now: ItemRow,
  itemKey: Uint8Array<ArrayBuffer>,
): Promise<VersionRow[]> {
  const rows = await readVersions(was.vault, was.id)
  const moved = await Promise.all(
    rows.map(async (row) => {
      try {
        const was = await openVersion(from.key, row.vault, row.id, row.rev, row.key, row.body)
        const envelope = await attachmentsUnder(was.envelope, now.id, [was.itemKey], itemKey)
        const sealed = await sealVersion(to.key, now.vault, now.id, row.rev, envelope, itemKey)
        return [{ ...row, vault: now.vault, ...sealed }]
      } catch {
        return []
      }
    }),
  )
  return moved.flat()
}

function heldVault(held: Held, id: string): HeldVault {
  const box = held.vaults.get(id)
  if (!box) throw new Error('pass: no such vault')
  return box
}

export async function sealPuts(
  held: Held,
  puts: readonly Put[],
  current: readonly Item[],
): Promise<Sealed> {
  const at = Date.now()
  const before = new Map(current.map((item) => [item.id, item]))
  const items: ItemRow[] = []
  const versions: VersionRow[] = []
  const dropVersions: ItemRow[] = []
  const kept: HeldItem[] = []
  const made: Item[] = []
  for (const put of puts) {
    const { vault, id, fresh } = put
    const box = heldVault(held, vault)
    const was = held.items.get(id)
    const moved = was !== undefined && was.row.vault !== vault
    const prior = fresh || (was && !moved) ? null : await readItem(vault, id)
    const renewed = moved ? newKey() : null
    const envelope =
      moved && renewed ? await attachmentsUnder(put.envelope, id, [was.key], renewed) : put.envelope
    const rev = Math.max(prior?.rev ?? 0, was?.row.rev ?? 0) + 1
    const last = Math.max(
      sealedRevOf(prior?.body ?? '') ?? 0,
      sealedRevOf(was?.row.body ?? '') ?? 0,
    )
    const sealing = { keyVersion: box.row.keyVersion, rev: Math.max(rev, last + 1) }
    const sealed = await sealItem(box.key, vault, id, envelope, sealing, renewed ?? was?.key)
    const row: ItemRow = {
      vault,
      id,
      rev,
      key: sealed.key,
      body: sealed.body,
      keyVersion: box.row.keyVersion,
      at,
      pending: true,
      deleted: false,
    }
    const shown = before.get(id)
    if (was && moved) {
      items.push(tombstoneOf(was.row, at))
      dropVersions.push(was.row)
      const from = heldVault(held, was.row.vault)
      versions.push(...(await movedVersions(from, box, was.row, row, sealed.itemKey)))
    } else if (was && shown && !sameContent(shown.content, envelope.content)) {
      const kept = await sealVersion(box.key, vault, id, was.row.rev, envelopeOf(shown), was.key)
      versions.push({ vault, id, rev: was.row.rev, at: was.row.at, ...kept })
    }
    items.push(row)
    kept.push({ key: sealed.itemKey, row })
    made.push(itemOf(row, envelope))
  }
  return { change: { items, versions, dropVersions }, held: kept, made }
}
