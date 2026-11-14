import type { Item, Vault } from '@orden/pass/types'
import type { ItemRef } from './local'

export interface Shown {
  vaults: Vault[]
  goneVaults: string[]
  items: Item[]
  goneItems: ItemRef[]
}

export function nothingShown(): Shown {
  return { vaults: [], goneVaults: [], items: [], goneItems: [] }
}

export function isShown(update: Shown): boolean {
  return (
    update.vaults.length +
      update.goneVaults.length +
      update.items.length +
      update.goneItems.length >
    0
  )
}

export function shownAfter(
  vaults: readonly Vault[],
  items: readonly Item[],
  update: Shown,
): { vaults: Vault[]; items: Item[] } {
  const goneVaults = new Set(update.goneVaults)
  const goneItems = new Set(update.goneItems.map((one) => `${one.vault}\n${one.id}`))
  const newVaults = new Map(update.vaults.map((one) => [one.id, one]))
  const newItems = new Map(update.items.map((one) => [one.id, one]))
  const keptVaults = vaults
    .filter((one) => !goneVaults.has(one.id))
    .map((one) => newVaults.get(one.id) ?? one)
  const knownVaults = new Set(keptVaults.map((one) => one.id))
  const keptItems = items
    .filter((one) => !goneVaults.has(one.vault) && !goneItems.has(`${one.vault}\n${one.id}`))
    .map((one) => newItems.get(one.id) ?? one)
  const knownItems = new Set(keptItems.map((one) => one.id))
  return {
    vaults: [
      ...keptVaults,
      ...update.vaults.filter((one) => !knownVaults.has(one.id) && !goneVaults.has(one.id)),
    ],
    items: [...keptItems, ...update.items.filter((one) => !knownItems.has(one.id))],
  }
}
