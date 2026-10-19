/** A board's manual order following its cards: a note renamed or moved, or a folder
 *  of them, has its old path rewritten in every `.base` of its space that orders it,
 *  the way links to it are (`retarget` in link-index.svelte.ts). Without it a renamed
 *  card would lose its place in its column. Fetched with the first move. */

import { type Base, readBase, writeBase } from '@nib/bases'
import { invoke } from '../tauri'
import { relativeTo } from '../space-paths'
import type { Entry } from '../workspace.svelte'

/** An order id with `from` (a path in the space, a note's or a folder's) moved to `to`. */
function movedId(id: string, from: string, to: string): string {
  if (id === from) return to
  if (id.startsWith(`${from}#`) || id.startsWith(`${from}/`)) return to + id.slice(from.length)
  return id
}

/** The base with every manual order naming `from` naming `to`, or null where none did. */
export function movedOrder(base: Base, from: string, to: string): Base | null {
  let changed = false
  const views = base.views.map((view) => {
    const order = view.nib.order
    if (!order) return view
    const next = Object.fromEntries(
      Object.entries(order).map(([group, ids]) => {
        const moved = ids.map((id) => movedId(id, from, to))
        if (moved.some((id, at) => id !== ids[at])) changed = true
        return [group, moved]
      }),
    )
    return { ...view, nib: { ...view.nib, order: next } }
  })
  return changed ? { ...base, views } : null
}

/** Every `.base` file under a folder of the tree. */
function basesIn(entry: Entry, found: string[] = []): string[] {
  for (const one of entry.children) {
    if (one.is_dir) basesIn(one, found)
    else if (/\.base$/i.test(one.name)) found.push(one.path)
  }
  return found
}

/** A move told to the bases of the space it happened in (`tree`, that space's). */
export async function orderMoved(
  tree: Entry,
  root: string,
  from: string,
  to: string,
): Promise<void> {
  const was = relativeTo(root, from)
  const now = relativeTo(root, to)
  if (!was || !now || was === now) return
  for (const path of basesIn(tree)) {
    const before = await invoke<string>('read_note', { path }).catch(() => null)
    if (before === null || !before.includes(was)) continue
    let base: Base
    try {
      base = readBase(before)
    } catch {
      continue
    }
    const next = movedOrder(base, was, now)
    if (!next) continue
    const after = writeBase(next, before)
    if (after !== before) await invoke('write_note', { path, content: after })
  }
}
