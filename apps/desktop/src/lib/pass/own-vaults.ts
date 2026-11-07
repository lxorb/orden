import type { Item, Vault } from '@orden/pass/types'

export interface OwnVault {
  vault: Vault
  items: Item[]
}

export function ownVaults(vaults: readonly Vault[], items: readonly Item[]): OwnVault[] {
  return vaults
    .filter((vault) => vault.role === 'owner')
    .map((vault) => ({ vault, items: items.filter((item) => item.vault === vault.id) }))
}
