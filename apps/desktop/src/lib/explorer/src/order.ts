import { folderOf, nameOf } from '../../platform/src/api'
import { byName } from '../../tree-order'
import type { Entry } from './commands'

export type SortKey = 'name' | 'modified' | 'created' | 'size' | 'kind' | 'folder'

export const SORT_KEYS: readonly SortKey[] = [
  'name',
  'modified',
  'created',
  'size',
  'kind',
  'folder',
]

export interface Sort {
  key: SortKey
  down: boolean
}

export function endingOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function firstDown(key: SortKey): boolean {
  return key === 'modified' || key === 'created' || key === 'size'
}

export function sortShown(sort: Sort, searching: boolean): Sort {
  return !searching && sort.key === 'folder' ? { key: 'name', down: sort.down } : sort
}

function kindOf(entry: Entry): string {
  return entry.folder ? '' : endingOf(nameOf(entry.name))
}

function compared(one: Entry, other: Entry, key: SortKey): number {
  switch (key) {
    case 'name':
      return 0
    case 'modified':
      return one.modified - other.modified
    case 'created':
      return one.created - other.created
    case 'size':
      return one.size - other.size
    case 'kind':
      return byName(kindOf(one), kindOf(other))
    case 'folder':
      return byName(folderOf(one.name), folderOf(other.name))
  }
}

function byLeaf(one: Entry, other: Entry): number {
  return byName(nameOf(one.name), nameOf(other.name)) || byName(one.name, other.name)
}

export function ordered(entries: readonly Entry[], sort: Sort, hidden: boolean): Entry[] {
  const turn = sort.down ? -1 : 1
  return entries
    .filter((one) => hidden || !one.hidden)
    .sort((one, other) => {
      if (one.folder !== other.folder) return one.folder ? -1 : 1
      const by = compared(one, other, sort.key)
      if (by !== 0) return by * turn
      return byLeaf(one, other) * (sort.key === 'name' ? turn : 1)
    })
}

export function filtered(entries: readonly Entry[], typed: string): Entry[] {
  const wanted = typed.trim().toLowerCase()
  if (!wanted) return [...entries]
  return entries.filter((one) => one.name.toLowerCase().includes(wanted))
}
