/** A note that holds notes.
 *
 *  Dropping one note onto another nests it, the way a page nests under a page in
 *  Notion. On disk that is the folder-note convention: `A.md` becomes the folder
 *  `A/` and moves inside it as `A/A.md`, and what was dropped on it lands in `A/`
 *  beside it. The tree then draws the folder as the note again, so the reader
 *  sees one row where they made one gesture.
 *
 *  Same name, inside the folder - not `A.md` left beside `A/`. Both layouts are
 *  the same idea, and both of the folder-note plugins an Obsidian vault is likely
 *  to have offer both: LostPaladin's `folder-notes` and xpgo's `folder-note-core`
 *  each default to looking for `A/A.md` and each has to be told to look outside
 *  the folder instead. So a space nib nested a note in reads as nested in Obsidian
 *  with nothing switched on, which is the point.
 *
 *  No icons here. A folder-note row draws the note's own path, so the mark it
 *  wears is whatever the note's front matter says and choosing one on the row
 *  writes it there; none of it belongs in the folder icon map. See
 *  FileMark.svelte.
 *
 *  Pure, and the whole rule: the tree, the drop zones, the Move sheet and the way
 *  back out all ask here. See folder-notes.test.ts. */

import { isMarkdownPath, withoutExtension } from './space-paths'
import { folderOf } from './tauri'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'

/** The folder a note would become: the note without its extension, so `A.md`
 *  makes `A/`.
 *
 *  Answers a path that is not a note unchanged, which is what makes it safe to
 *  ask about any row: a PDF becomes no folder, and no folder is ever called
 *  `paper.pdf`. */
export function folderFor(note: string): string {
  return withoutExtension(note)
}

/** The note a folder is drawn as, or null for a folder that is only a folder.
 *
 *  The name has to match exactly. A vault where `Notes/` happens to hold
 *  `notes.md` is a folder holding a note, and reading it as one thing because two
 *  filesystems disagree about capitals would fold a row somebody meant to keep. */
export function folderNote(entry: Entry): Entry | null {
  if (!entry.is_dir) return null

  return (
    entry.children.find(
      (child) =>
        !child.is_dir && isMarkdownPath(child.name) && withoutExtension(child.name) === entry.name,
    ) ?? null
  )
}

/** What the tree draws under the row: everything the folder holds except its own
 *  note, which is the row itself. Listing it again would be the same note twice,
 *  once as the row and once inside it. */
export function nestedIn(entry: Entry): Entry[] {
  const own = folderNote(entry)
  return own ? entry.children.filter((child) => child.path !== own.path) : entry.children
}

/** The note a drop is about to make a folder out of, or null when the folder is
 *  already a folder - which is every other drop.
 *
 *  Reads the tree rather than the path, because the answer is about what exists:
 *  a vault may already have `A/` with `A.md` beside it, and then a drop on the
 *  note is an ordinary move into the folder that is there. The note becomes its
 *  folder note by arriving, and nothing has to be made. */
export function noteToNest(tree: Entry | null, folder: string): string | null {
  const here = entryAt(tree, folderOf(folder))
  if (!here || here.children.some((child) => child.is_dir && child.path === folder)) return null

  const note = here.children.find(
    (child) => !child.is_dir && isMarkdownPath(child.name) && folderFor(child.path) === folder,
  )

  return note?.path ?? null
}

/** A folder left holding nothing but its own note, which is a folder that has
 *  stopped being one: the note to bring back up, where it goes, and the folder to
 *  take away.
 *
 *  Automatic, because the way in was: nesting a note was one drag, and a reader
 *  who drags the last row back out has undone it. An empty `A/` left standing
 *  beside `A.md` would be tidying up after a gesture nobody knew they had made. */
export function unnesting(entry: Entry): { note: string; into: string; folder: string } | null {
  const own = folderNote(entry)
  if (!own || entry.children.length > 1) return null

  return { note: own.path, into: folderOf(entry.path), folder: entry.path }
}

/** Renaming the row: the note inside the folder, and then the folder.
 *
 *  In that order, because the note is what the links point at. `workspace.rename`
 *  rewrites them by resolving each against the space as it stands, and they still
 *  resolve to the note while it is where it was; renaming the folder first would
 *  move it out from under them.
 *
 *  Nothing at all for a name with nothing in it, which is a field somebody
 *  cleared rather than a rename. */
export function renameSteps(note: string, typed: string): { path: string; name: string }[] {
  const name = withoutExtension(typed.trim())
  if (!name) return []

  // The note keeps the extension it was written with, so a vault of `.markdown`
  // files stays a vault of `.markdown` files.
  const extension = /\.[^.]+$/.exec(note)?.[0] ?? '.md'

  return [
    { path: note, name: name + extension },
    { path: folderOf(note), name },
  ]
}
