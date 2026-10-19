/** A board's manual order following its cards: a note renamed or moved, or a folder
 *  of them, has its old path rewritten in every `.base` of its space that orders it,
 *  and in the fence of a database's note,
 *  the way links to it are (`retarget` in link-index.svelte.ts). Without it a renamed
 *  card would lose its place in its column. Fetched with the first move. */

import { type Base, readBase, writeBase } from '@nib/bases'
import { folderNotePath } from '../folder-notes'
import { folderOf, relativeTo } from '../space-paths'
import { type Entry, workspace } from '../workspace.svelte'
import { noteText, writeNoteText } from '../workspace/note-text'

/** An order id with `from` (a path in the space, a note's or a folder's) moved to `to`. */
function movedId(id: string, from: string, to: string): string {
  if (id === from) return to
  if (id.startsWith(`${from}#`) || id.startsWith(`${from}/`)) return to + id.slice(from.length)
  return id
}

/** The base with every manual order naming `from` naming `to`, or null where none did. */
export function movedOrder(base: Base, from: string, to: string): Base | null {
  let changed = false as boolean
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

/** A path on this disk with `from` (a note's or a folder's) moved to `to`. */
function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

/** The notes a database's board could stand in, as a fence: the note of each folder
 *  the moved note is in, `A/A.md` as nib writes it and `A.md` beside `A/` as an
 *  import from Notion does. Only these are read, so a rename reads a handful of notes
 *  and not the space. */
function foldersNotes(root: string, path: string): string[] {
  const found: string[] = []
  for (let dir = folderOf(path); dir.length > root.length; dir = folderOf(dir)) {
    found.push(folderNotePath(dir), `${dir}.md`)
  }
  return found
}

const FENCE = /^(```+|~~~+)base[^\n]*\n([\s\S]*?)^\1[^\S\n]*$/gm

/** The words of a `.base` file, or of a note's base fences, with the move made; null
 *  where nothing named it. */
export function movedWords(text: string, fenced: boolean, was: string, now: string): string | null {
  const rewrite = (words: string): string | null => {
    let base: Base
    try {
      base = readBase(words)
    } catch {
      return null
    }
    const next = movedOrder(base, was, now)
    return next ? writeBase(next, words) : null
  }
  if (!fenced) return rewrite(text)
  let changed = false as boolean
  const after = text.replace(FENCE, (whole, fence: string, body: string) => {
    const next = rewrite(body)
    if (next === null) return whole
    changed = true
    const head = whole.slice(0, whole.indexOf('\n') + 1)
    return `${head}${next.endsWith('\n') ? next : `${next}\n`}${fence}`
  })
  return changed ? after : null
}

/** A move told to the bases of the space it happened in (`tree`, that space's, as it
 *  stood before the move): every `.base` file, where it is now, and the notes a
 *  database's fence could be in. Read and written the way every note is, so an open
 *  board and an open note take the change. */
export async function orderMoved(
  tree: Entry,
  root: string,
  from: string,
  to: string,
): Promise<void> {
  const was = relativeTo(root, from)
  const now = relativeTo(root, to)
  if (!was || !now || was === now) return
  const files = basesIn(tree).map((path) => ({ path: movedPath(path, from, to), fenced: false }))
  // A folder moved is a database renamed as often as not: its own note too.
  const own = [folderNotePath(to), `${to}.md`]
  const notes = [...new Set([...own, ...foldersNotes(root, to)])].map((path) => ({
    path,
    fenced: true,
  }))
  for (const { path, fenced } of [...files, ...notes]) {
    const before = await noteText(workspace, path)
    if (!before?.includes(was)) continue
    const after = movedWords(before, fenced, was, now)
    if (after !== null && after !== before) await writeNoteText(workspace, path, before, after)
  }
}
