/** Which folder a drag over the file list would drop into.
 *
 *  One answer for the whole list rather than one per component. The list draws a
 *  component per folder, so a note held over a row deep inside one has to light a
 *  row that another of them drew - and the row that should light is never the
 *  note. A note stands for the folder it sits in: dropping onto one means "in
 *  here, beside it", which is what makes a folder holding a single note something
 *  a drag can get back out of. So the answer is always a folder, and it is kept
 *  here under the folder's own path, which is what the row compares against.
 *
 *  A row at the top of a space stands for the space itself, and what lights for
 *  that is the space below the last row; see Sidebar.svelte. */

import { folderOf } from './tauri'

/** The folder a row stands for: a folder is itself, a note is its own folder. */
export function targetFor(path: string, isFolder: boolean): string {
  return isFolder ? path : folderOf(path)
}

class DropTarget {
  /** The folder a drop would land in, or null while nothing is over the list. */
  folder = $state<string | null>(null)

  /** Whether this folder is the one lit. An empty path is not a folder, so two
   *  of them are not the same folder either. */
  lit(folder: string): boolean {
    return !!this.folder && this.folder === folder
  }

  over(folder: string) {
    this.folder = folder
  }

  clear() {
    this.folder = null
  }
}

export const dropTarget = new DropTarget()
