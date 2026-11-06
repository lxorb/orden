import { walked } from './walk'

export interface TreeRow {
  path: string
  folder: boolean
  open: boolean
}

export type TreeStep =
  { do: 'stand'; path: string } | { do: 'expand'; path: string } | { do: 'collapse'; path: string }

export const TREE_MOVES: readonly (readonly [string, string])[] = [
  ['tree.down', 'ArrowDown'],
  ['tree.up', 'ArrowUp'],
  ['tree.into', 'ArrowRight'],
  ['tree.out', 'ArrowLeft'],
]

function holds(folder: string, path: string): boolean {
  const one = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  return path.replace(/\\/g, '/').startsWith(`${one}/`)
}

export function treeStep(
  key: string,
  rows: readonly TreeRow[],
  here: string | null,
): TreeStep | null {
  const at = here === null ? -1 : rows.findIndex((row) => row.path === here)
  const row = at < 0 ? undefined : rows[at]

  const moved = walked(key, at < 0 ? null : at, rows.length)
  if (moved !== null) {
    const landed = rows[moved]
    return landed ? { do: 'stand', path: landed.path } : null
  }

  if (!row) return null

  if (key === 'ArrowRight') {
    if (!row.folder) return null
    if (!row.open) return { do: 'expand', path: row.path }

    const first = rows[at + 1]
    return first && holds(row.path, first.path) ? { do: 'stand', path: first.path } : null
  }

  if (key === 'ArrowLeft') {
    if (row.folder && row.open) return { do: 'collapse', path: row.path }

    for (let above = at - 1; above >= 0; above--) {
      const one = rows[above]
      if (one && holds(one.path, row.path)) return { do: 'stand', path: one.path }
    }

    return null
  }

  return null
}

export function onTwist(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.twist') !== null
}
