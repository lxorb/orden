import { byName } from '../tree-order'
import type { Entry } from './commands'

export type SortKey = 'name' | 'modified' | 'size' | 'kind'

export interface Sort {
  key: SortKey
  down: boolean
}

export function endingOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function compared(one: Entry, other: Entry, key: SortKey): number {
  switch (key) {
    case 'name':
      return 0
    case 'modified':
      return one.modified - other.modified
    case 'size':
      return one.size - other.size
    case 'kind':
      return byName(endingOf(one.name), endingOf(other.name))
  }
}

export function ordered(entries: readonly Entry[], sort: Sort, hidden: boolean): Entry[] {
  const turn = sort.down ? -1 : 1
  return entries
    .filter((one) => hidden || !one.hidden)
    .sort((one, other) => {
      if (one.folder !== other.folder) return one.folder ? -1 : 1
      const by = compared(one, other, sort.key)
      if (by !== 0) return by * turn
      return byName(one.name, other.name) * (sort.key === 'name' ? turn : 1)
    })
}

export function filtered(entries: readonly Entry[], typed: string): Entry[] {
  const wanted = typed.trim().toLowerCase()
  if (!wanted) return [...entries]
  return entries.filter((one) => one.name.toLowerCase().includes(wanted))
}
