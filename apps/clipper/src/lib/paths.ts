/** Where a clip lands inside a space.
 *
 *  The API refuses a path that is already taken, so a free one is found by
 *  asking: `Idea.md`, then `Idea 2.md`, then `Idea 3.md`, the number before the
 *  extension. That is the numbering the app gives a duplicate everywhere else -
 *  `free_spot` in the Tauri crate, `freePath` in the sync service - and a
 *  clipped note should number the same way as one made in the app. */

/** The folder a person typed, as a path a space understands: forward slashes,
 *  relative, and with nothing in it that could climb out. */
export function cleanFolder(input: string): string {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(/[<>:"|?*\p{Cc}]/gu, ' ').trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
}

export function inFolder(folder: string, name: string): string {
  const clean = cleanFolder(folder)
  return clean ? `${clean}/${name}` : name
}

/** The `counter`th spelling of a path. One is the name itself; after that the
 *  number goes before the extension, so `a/Idea.md` becomes `a/Idea 2.md`. */
export function numbered(path: string, counter: number): string {
  if (counter <= 1) return path

  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash + 1)
  const file = path.slice(slash + 1)

  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot) : ''

  return `${folder}${stem} ${counter}${extension}`
}
