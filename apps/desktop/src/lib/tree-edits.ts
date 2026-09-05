/** Changes to the file tree, applied before the filesystem has answered.
 *
 *  Making a note, renaming one, moving one, deleting one: each is a round trip
 *  to disk and then a fresh listing of the whole folder, and until both come
 *  back the tree shows the way it was. On a local disk that is a flicker; over
 *  a synced folder, or in the browser build where the listing is rebuilt from
 *  storage, it is long enough to wonder whether the click landed. So the row
 *  moves at once and the listing that follows puts it right - it is still the
 *  truth, and an operation that failed simply undoes itself when it arrives.
 *
 *  Every function here returns a new tree rather than editing the one it was
 *  given, so the reactive state sees a change, and none of them touch the
 *  filesystem: they are what the tree would look like if the operation
 *  succeeded, which it usually does. */

import type { Entry, SortKey, TreeOptions } from './workspace.svelte'

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

/** The order the listing itself uses: folders first, then the chosen key. */
export function compareEntries(options: TreeOptions): (a: Entry, b: Entry) => number {
  const key: SortKey = options.sort
  const by = (a: Entry, b: Entry) => {
    if (key === 'modified') return a.modified - b.modified
    if (key === 'created') return a.created - b.created
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
  }

  return (a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return options.descending ? -by(a, b) : by(a, b)
  }
}

/** `tree` with `change` applied to the children of the folder at `path`. */
function inFolder(
  tree: Entry,
  path: string,
  change: (children: Entry[]) => Entry[],
): Entry {
  if (tree.path === path) return { ...tree, children: change([...tree.children]) }
  if (!path.startsWith(tree.path)) return tree

  return {
    ...tree,
    children: tree.children.map((child) => (child.is_dir ? inFolder(child, path, change) : child)),
  }
}

/** A new note or folder, in the place the listing would put it. */
export function withEntry(tree: Entry, entry: Entry, options: TreeOptions): Entry {
  const order = compareEntries(options)
  return inFolder(tree, folderOf(entry.path), (children) => {
    const kept = children.filter((child) => child.path !== entry.path)
    const at = kept.findIndex((child) => order(entry, child) < 0)
    if (at < 0) return [...kept, entry]
    return [...kept.slice(0, at), entry, ...kept.slice(at)]
  })
}

/** A row that is on its way out. */
export function withoutEntry(tree: Entry, path: string): Entry {
  return inFolder(tree, folderOf(path), (children) =>
    children.filter((child) => child.path !== path),
  )
}

/** The entry at `path`, or null. */
export function entryAt(tree: Entry | null, path: string): Entry | null {
  if (!tree) return null
  if (tree.path === path) return tree
  if (!path.startsWith(tree.path)) return null

  for (const child of tree.children) {
    const found = entryAt(child, path)
    if (found) return found
  }
  return null
}

/** Every path under `entry`, itself included, rewritten from `from` to `to`.
 *  A folder takes its contents along, so the rows inside it keep working. */
function rebased(entry: Entry, from: string, to: string): Entry {
  const path = to + entry.path.slice(from.length)
  return {
    ...entry,
    path,
    name: basename(path),
    children: entry.children.map((child) => rebased(child, from, to)),
  }
}

/** A note or folder under its new name, or in its new folder. */
export function withMove(tree: Entry, from: string, to: string, options: TreeOptions): Entry {
  const entry = entryAt(tree, from)
  if (!entry || from === to) return tree
  return withEntry(withoutEntry(tree, from), rebased(entry, from, to), options)
}
