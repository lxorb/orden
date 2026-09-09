/** Where a note or a folder in the file list can be moved to.
 *
 *  On a touch screen a drag is not available: a press that stays still opens the
 *  row's menu, a press that moves scrolls the list, and the browser's drag events
 *  do not fire from a finger at all. So the menu offers the move instead, and
 *  this works out what it offers.
 *
 *  The list is exactly where a mouse could drop the thing, no more: any folder of
 *  the space it is in, any note in it, since a note dropped on a note nests, and
 *  any other space there is - which is what carrying a note onto another space used
 *  to mean. Its own place is left out, because a move to where it already is is not
 *  a move, and so is anything inside a folder being moved, because a folder cannot
 *  be put into itself.
 *
 *  Pure, so the rule can be read as a list of paths rather than driven through a
 *  sheet; see move-targets.test.ts. */

import { folderFor, folderNote } from './folder-notes'
import { isMarkdownPath } from './space-paths'
import type { Entry } from './workspace.svelte'

export interface MoveTarget {
  /** The folder to move into. For a note that is the folder it is about to
   *  become; the move itself makes it, so nothing here has to know that. */
  id: string
  /** What it is called in the list: where it sits, said as shortly as it can be. */
  label: string
  /** What the row wears: the folder mark, or a note's for a note - and, where
   *  whatever is at that path chose an icon, that instead. The sheet reads it off
   *  the `id`; see FileMark.svelte. */
  mark: 'folder' | 'note'
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

/** One place a row can land: the folder it moves into, and what that folder is
 *  called and drawn as. */
interface Place {
  path: string
  name: string
  mark: 'folder' | 'note'
  /** The note this place is made out of, for a note that has no folder yet, so a
   *  note is not offered its own folder to move into. Null for a real folder. */
  note: string | null
}

/** Every place in the tree, the root first and then depth first, which is the
 *  order the file list itself draws them in.
 *
 *  A folder that holds its own note is offered as that note, because that is the
 *  row the reader sees; the note inside it is not offered again, since moving into
 *  it would mean `A/A/` and there is no such thing. */
function placesIn(entry: Entry): Place[] {
  const own = folderNote(entry)
  const out: Place[] = [
    { path: entry.path, name: entry.name, mark: own ? 'note' : 'folder', note: null },
  ]

  // A folder wins over the note that shares its name: it already exists, so a
  // drop into it is an ordinary move rather than a nesting, and offering both
  // would be one folder twice.
  const folders = new Set(entry.children.filter((child) => child.is_dir).map((one) => one.path))

  for (const child of entry.children) {
    if (child.path === own?.path) continue

    if (child.is_dir) out.push(...placesIn(child))
    else if (isMarkdownPath(child.name) && !folders.has(folderFor(child.path))) {
      out.push({
        path: folderFor(child.path),
        name: child.name,
        mark: 'note',
        note: child.path,
      })
    }
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

  const inside: MoveTarget[] = !tree
    ? []
    : placesIn(tree)
        // Where it already is, itself, and anything inside it - and, for a note,
        // the folder it would itself become, since a note cannot hold itself.
        .filter((place) => place.note !== moving && movesInto([moving], place.path))
        .map((place) => ({
          id: place.path,
          mark: place.mark,
          // The space's own name for its root, and the path inside it for the
          // rest: a folder three deep is only itself if the way to it is shown.
          label:
            place.path === tree.path
              ? (space?.name ?? place.name)
              : place.path
                  .slice(tree.path.length)
                  .replace(/^[\\/]+/, '')
                  .replace(/\\/g, '/'),
        }))

  // The other spaces, which is the only way a note moves between two of them.
  const elsewhere: MoveTarget[] = spaces
    .filter((one) => one.root !== here)
    .map((one) => ({ id: one.root, label: one.name, mark: 'folder' as const }))

  return [...inside, ...elsewhere]
}
