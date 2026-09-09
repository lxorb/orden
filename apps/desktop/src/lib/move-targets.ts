/** Where a note or a folder in the file list can be moved to.
 *
 *  On a touch screen a drag is not available: a press that stays still opens the
 *  row's menu, a press that moves scrolls the list, and the browser's drag events
 *  do not fire from a finger at all. So the menu offers the move instead, and
 *  this works out what it offers.
 *
 *  The list is exactly where a mouse could drop the thing, no more: any folder of
 *  the space it is in, and any other space there is - which is what carrying a
 *  note onto another space used to mean. Its own place is left out, because a move to
 *  where it already is is not a move, and so is anything inside a folder being
 *  moved, because a folder cannot be put into itself.
 *
 *  Pure, so the rule can be read as a list of paths rather than driven through a
 *  sheet; see move-targets.test.ts. */

import type { Entry } from './workspace.svelte'

export interface MoveTarget {
  /** The folder to move into. */
  id: string
  /** What it is called in the list: where it sits, said as shortly as it can be. */
  label: string
}

export interface Space {
  name: string
  root: string
}

/** The folder a path sits in, by the separator it uses. */
function parentOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path : path.slice(0, at)
}

/** Whether `path` is `folder` or sits anywhere inside it. */
function under(folder: string, path: string): boolean {
  const one = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  const other = path.replace(/\\/g, '/')
  return other === one || other.startsWith(`${one}/`)
}

/** Whether moving these rows into `folder` would move anything at all.
 *
 *  The same rule the list below is filtered by, asked the other way round: the
 *  menu names a row and asks which folders will take it, while a drag names a
 *  folder and asks whether it takes what is coming. So a folder cannot be
 *  dropped into itself or into anything inside it, and a row already in the
 *  folder is not moving.
 *
 *  A drag over the file list cannot read the transfer - a browser hides what is
 *  being dragged until the drop - so what is coming is this window's own note of
 *  it; see `carried` in drag-paths.ts. */
export function movesInto(paths: readonly string[], folder: string): boolean {
  return paths.some((path) => parentOf(path) !== folder && !under(path, folder))
}

/** Every folder in the tree, the root first and then depth first, which is the
 *  order the file list itself draws them in. */
function foldersIn(entry: Entry): Entry[] {
  const out = [entry]
  for (const child of entry.children) {
    if (child.is_dir) out.push(...foldersIn(child))
  }

  return out
}

export function moveTargets(input: {
  /** The note or folder being moved. */
  moving: string
  /** The space on screen, as the file list holds it. */
  tree: Entry | null
  /** Every space there is, in the order the switcher shows them. */
  spaces: readonly Space[]
  /** Which of them is on screen. */
  here: string | null
}): MoveTarget[] {
  const { moving, tree, spaces, here } = input
  const space = spaces.find((one) => one.root === here) ?? null

  const folders: MoveTarget[] = !tree
    ? []
    : foldersIn(tree)
        // Where it already is, itself, and anything inside it.
        .filter((folder) => movesInto([moving], folder.path))
        .map((folder) => ({
          id: folder.path,
          // The space's own name for its root, and the path inside it for the
          // rest: a folder three deep is only itself if the way to it is shown.
          label:
            folder.path === tree.path
              ? (space?.name ?? folder.name)
              : folder.path
                  .slice(tree.path.length)
                  .replace(/^[\\/]+/, '')
                  .replace(/\\/g, '/'),
        }))

  // The other spaces, which is the only way a note moves between two of them.
  const elsewhere: MoveTarget[] = spaces
    .filter((one) => one.root !== here)
    .map((one) => ({ id: one.root, label: one.name }))

  return [...folders, ...elsewhere]
}
