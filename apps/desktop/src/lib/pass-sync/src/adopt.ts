import { newKey } from '@orden/pass/crypto'
import type { Opened } from '@orden/pass/keys'
import { sealItem } from '@orden/pass/keys'
import type { Folder, Item, Vault, VaultMeta } from '@orden/pass/types'
import type { Change, ItemRow, VaultRow } from './local'
import { envelopeOf, newId, tombstoneOf } from './rows'
import { FIRST_KEY_VERSION, madeVaultRow } from './vault-made'

function foldersOf(vaults: readonly Vault[]): Folder[] {
  const seen = new Map<string, Folder>()
  for (const vault of vaults) for (const one of vault.folders) seen.set(one.id, one)
  return [...seen.values()]
}

export interface Before {
  vaults: readonly VaultRow[]
  items: readonly ItemRow[]
}

export async function adoptedChange(
  before: Before,
  items: readonly Item[],
  vaults: readonly Vault[],
  account: Opened,
  name: string,
): Promise<Change> {
  const at = Date.now()
  const old = before.items.filter((row) => !row.deleted)
  const change: Required<Change> = {
    vaults: before.vaults.map((row) => ({ ...row, pending: false, deleted: true })),
    items: before.items.map((row) =>
      row.deleted ? { ...row, pending: false } : { ...tombstoneOf(row, at), pending: false },
    ),
    versions: [],
    dropVersions: old,
  }
  if (!items.length) return change
  const id = newId()
  const key = newKey()
  const meta: VaultMeta = {
    v: 1,
    name,
    description: '',
    color: 'purple',
    icon: 'home',
    folders: foldersOf(vaults),
    hidePasswordsFromViewers: false,
  }
  change.vaults.push(await madeVaultRow(account, id, key, meta))
  const at1 = { keyVersion: FIRST_KEY_VERSION, rev: 1 }
  for (const item of items) {
    const sealed = await sealItem(key, id, item.id, envelopeOf(item), at1)
    const row: ItemRow = {
      vault: id,
      id: item.id,
      rev: 1,
      key: sealed.key,
      body: sealed.body,
      keyVersion: FIRST_KEY_VERSION,
      at,
      pending: true,
      deleted: false,
    }
    change.items.push(row)
  }
  return change
}
