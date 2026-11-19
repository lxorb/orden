import { expect } from 'vitest'
import type { Content, ContentOf, ItemKind } from '../types'
import type { Imported, ImportedItem } from './types'

export function find(result: Imported, title: string): ImportedItem {
  const found = result.vaults.flatMap((vault) => vault.items).find((one) => one.content.title === title)
  if (!found) throw new Error(`no item ${title}`)
  return found
}
export function as<K extends ItemKind>(content: Content, kind: K): ContentOf<K> {
  expect(content.kind).toBe(kind)
  return content as ContentOf<K>
}
