import type { Content, Folder, Item, ItemKind, Vault } from '@orden/pass/types'
import { hostOf } from '@orden/pass/urls'

export type Scope =
  | { kind: 'all' }
  | { kind: 'vault'; vault: string; folder: string | null }
  | { kind: 'trash' }
  | { kind: 'shared-with-me' }
  | { kind: 'shared-by-me' }

export const TYPE_FILTERS = ['all', 'login', 'alias', 'card', 'note', 'identity', 'other'] as const
export type TypeFilter = (typeof TYPE_FILTERS)[number]

export const SORTS = ['recent', 'title', 'newest', 'oldest'] as const
export type Sort = (typeof SORTS)[number]

export interface Listed {
  pinned: Item[]
  rows: Item[]
  counts: Record<TypeFilter, number>
}

function filterOf(kind: ItemKind): Exclude<TypeFilter, 'all'> {
  switch (kind) {
    case 'login':
    case 'alias':
    case 'card':
    case 'note':
    case 'identity':
      return kind
    case 'custom':
    case 'ssh':
    case 'wifi':
      return 'other'
  }
}

function subtreeOf(folders: readonly Folder[], root: string): Set<string> {
  const inside = new Set([root])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) {
      if (folder.parent !== null && inside.has(folder.parent) && !inside.has(folder.id)) {
        inside.add(folder.id)
        grew = true
      }
    }
  }
  return inside
}

function inScope(scope: Scope, vaults: readonly Vault[]): (item: Item) => boolean {
  const byId = new Map(vaults.map((vault) => [vault.id, vault]))
  const live = (item: Item) => item.trashed === null
  switch (scope.kind) {
    case 'all':
      return live
    case 'trash':
      return (item) => item.trashed !== null
    case 'vault': {
      const folders = byId.get(scope.vault)?.folders ?? []
      const inside = scope.folder === null ? null : subtreeOf(folders, scope.folder)
      return (item) =>
        live(item) &&
        item.vault === scope.vault &&
        (inside === null || (item.folder !== null && inside.has(item.folder)))
    }
    case 'shared-with-me':
      return (item) => live(item) && byId.get(item.vault)?.role !== 'owner'
    case 'shared-by-me':
      return (item) => {
        const vault = byId.get(item.vault)
        return live(item) && vault?.role === 'owner' && vault.shared
      }
  }
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  )
}

function lastFour(number: string): string {
  return number.replace(/\D/g, '').slice(-4)
}

function searchedOf(content: Content): string[] {
  const words = [content.title, firstLine(content.note)]
  switch (content.kind) {
    case 'login':
      words.push(content.username, content.email)
      for (const website of content.websites) words.push(hostOf(website.url) ?? '')
      break
    case 'alias':
      words.push(content.address)
      break
    case 'card':
      words.push(lastFour(content.number))
      break
    case 'identity':
      words.push(content.values.fullName ?? '', content.values.email ?? '')
      break
    case 'wifi':
      words.push(content.ssid)
      break
    case 'note':
    case 'custom':
    case 'ssh':
      break
  }
  return words.filter((word) => word !== '').map((word) => word.toLowerCase())
}

function matchesQuery(query: string): (item: Item) => boolean {
  const wanted = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!wanted.length) return () => true
  return (item) => {
    const searched = searchedOf(item.content)
    return wanted.every((word) => searched.some((one) => one.includes(word)))
  }
}

const recency = (item: Item) => Math.max(item.modified, item.used ?? 0)

function compare(sort: Sort): (a: Item, b: Item) => number {
  switch (sort) {
    case 'recent':
      return (a, b) => recency(b) - recency(a)
    case 'title':
      return (a, b) =>
        a.content.title.localeCompare(b.content.title, undefined, { sensitivity: 'base' }) ||
        b.created - a.created
    case 'newest':
      return (a, b) => b.created - a.created
    case 'oldest':
      return (a, b) => a.created - b.created
  }
}

export function listed(
  items: readonly Item[],
  vaults: readonly Vault[],
  scope: Scope,
  filter: TypeFilter,
  sort: Sort,
  query: string,
): Listed {
  const within = items.filter(inScope(scope, vaults)).filter(matchesQuery(query))
  const counts: Record<TypeFilter, number> = {
    all: within.length,
    login: 0,
    alias: 0,
    card: 0,
    note: 0,
    identity: 0,
    other: 0,
  }
  for (const item of within) counts[filterOf(item.content.kind)]++
  const rows = (
    filter === 'all' ? within : within.filter((item) => filterOf(item.content.kind) === filter)
  ).sort(compare(sort))
  const pinned = scope.kind === 'trash' ? [] : rows.filter((item) => item.pinned)
  return { pinned, rows, counts }
}

export function subtitleOf(item: Item): string {
  const content = item.content
  switch (content.kind) {
    case 'login':
      return content.username || content.email
    case 'alias':
      return content.address
    case 'card': {
      const four = lastFour(content.number)
      return four ? `•••• ${four}` : content.holder
    }
    case 'note':
      return firstLine(content.note)
    case 'identity':
      return [content.values.fullName, content.values.email].find(Boolean) ?? ''
    case 'custom':
      return firstLine(content.note)
    case 'ssh':
      return content.publicKey.trim().split(/\s+/)[0] ?? ''
    case 'wifi':
      return content.ssid
  }
}
