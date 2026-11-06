import { folderNote, nestedIn } from './folder-notes'
import type { Entry } from './workspace.svelte'

export interface FlatRow {
  entry: Entry
  depth: number
}

export function standsOpen(entry: Entry, isOpen: (path: string) => boolean): boolean {
  return entry.is_dir && isOpen(entry.path) && nestedIn(entry).length > 0
}

export function anyOpen(tree: Entry | null, isOpen: (path: string) => boolean): boolean {
  return tree?.children.some((child) => standsOpen(child, isOpen)) ?? false
}

export function flatRows(tree: Entry | null, isOpen: (path: string) => boolean): FlatRow[] {
  const out: FlatRow[] = []
  if (!tree) return out

  const walk = (entry: Entry, depth: number) => {
    const own = depth > 0 ? folderNote(entry) : null

    for (const child of entry.children) {
      if (own?.path === child.path) continue

      out.push({ entry: child, depth })
      if (standsOpen(child, isOpen)) walk(child, depth + 1)
    }
  }

  walk(tree, 0)
  return out
}

export function heldRows(entry: Entry, isOpen: (path: string) => boolean): number {
  if (!entry.is_dir) return 0

  let count = 0
  for (const child of nestedIn(entry)) {
    count += 1
    if (standsOpen(child, isOpen)) count += heldRows(child, isOpen)
  }

  return count
}

export function rowIndex(rows: readonly FlatRow[]): Map<string, number> {
  const at = new Map<string, number>()
  for (const [index, row] of rows.entries()) at.set(row.entry.path, index)
  return at
}
