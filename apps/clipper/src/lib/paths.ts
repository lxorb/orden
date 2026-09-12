/** Where a clip lands inside a space.
 *
 *  The API refuses a path that is already taken, so a free one is found by
 *  asking: `Idea.md`, then `Idea 2.md`, then `Idea 3.md`, the number before the
 *  extension. That is `numbered` in @nib/markdown/paths, which is the numbering
 *  the app gives a duplicate everywhere else - `free_spot` in the Tauri crate,
 *  `freePath` in the sync service - and a clipped note should number the same way
 *  as one made in the app. */

import { withoutForbidden } from '@nib/markdown/paths'

/** The folder a person typed, as a path a space understands: forward slashes,
 *  relative, and with nothing in it that could climb out. */
export function cleanFolder(input: string): string {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => withoutForbidden(part).trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
}

export function inFolder(folder: string, name: string): string {
  const clean = cleanFolder(folder)
  return clean ? `${clean}/${name}` : name
}
