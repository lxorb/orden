/** Walking the file list with the keys.
 *
 *  What a press comes to, worked out from the rows on show and nothing else: the
 *  arrows step between them, right opens a folder and then steps into it, left
 *  closes one and otherwise steps out to the folder holding this row. Pure, so
 *  the rule reads as a list of paths rather than as a list somebody has to drive
 *  with a mouse; see tree-keys.test.ts and Tree.svelte.
 *
 *  Which key does which is the registry's to say, so a reader can change it; the
 *  standard name of each is the vocabulary here. */

import { walked } from './walk'

/** One row of the list as a walk sees it. */
export interface TreeRow {
  path: string
  /** Whether it holds rows of its own. */
  folder: boolean
  /** Whether a folder is showing what it holds. */
  open: boolean
}

/** What a press comes to: a row to stand on, or a folder to open or shut. */
export type TreeStep =
  { do: 'stand'; path: string } | { do: 'expand'; path: string } | { do: 'collapse'; path: string }

/** The list's own keys: the id the registry holds each under, and the standard
 *  name of the key it starts on. The ids are what a reader rebinds, and the
 *  names are what the walk below is written in.
 *
 *  A menu reads the same names straight off the event, because a menu's arrows
 *  are not anybody's to change; see AppMenu.svelte. */
export const TREE_MOVES: readonly (readonly [string, string])[] = [
  ['tree.down', 'ArrowDown'],
  ['tree.up', 'ArrowUp'],
  ['tree.into', 'ArrowRight'],
  ['tree.out', 'ArrowLeft'],
]

/** Whether a path sits inside a folder, whichever separator was written. */
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

  // Up and down are the same walk every list in the app takes. The ends do not
  // meet: falling off the bottom of a folder into the top of the space would
  // lose the place somebody was reading down from.
  const moved = walked(key, at < 0 ? null : at, rows.length)
  if (moved !== null) {
    const landed = rows[moved]
    return landed ? { do: 'stand', path: landed.path } : null
  }

  if (!row) return null

  if (key === 'ArrowRight') {
    if (!row.folder) return null
    if (!row.open) return { do: 'expand', path: row.path }

    // Open already, so right goes in. An open folder with nothing in it has
    // nowhere to go, and the row after it is its neighbour rather than its
    // child.
    const first = rows[at + 1]
    return first && holds(row.path, first.path) ? { do: 'stand', path: first.path } : null
  }

  if (key === 'ArrowLeft') {
    if (row.folder && row.open) return { do: 'collapse', path: row.path }

    // Out to the folder this row is in, which is the nearest one above it that
    // holds it. A row at the top of the space has none, and left does nothing.
    for (let above = at - 1; above >= 0; above--) {
      const one = rows[above]
      if (one && holds(one.path, row.path)) return { do: 'stand', path: one.path }
    }

    return null
  }

  return null
}
