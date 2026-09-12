/** What a note may be called, and what it is called when that name is taken.
 *
 *  Four places wrote the same two rules. A clip landing in a space, an import
 *  landing in a folder, the same import keeping its own names apart, and a note
 *  coming back out of Recently deleted all have to step a name aside the way the
 *  app itself does - `Plan 2.md`, the number before the extension - and three of
 *  them also had to take out what a filesystem refuses. Their copies had drifted:
 *  one counted the last dot of the whole path rather than of the file's own name,
 *  so a note with no extension under a folder called `v1.2` stepped aside to
 *  `v1 2.2/Note`, a path in a folder nobody had.
 *
 *  Here rather than in either app because both apps and the sync service write
 *  notes, and a name that steps aside differently depending on which of them
 *  wrote it is a name the other two cannot predict. */

/** What no file may hold on Windows, plus the slash nobody may hold anywhere,
 *  and the control characters a pasted title can carry.
 *
 *  Windows' rule, because it is the strictest of the three and a space that opens
 *  on one machine has to open on the others. */
const FORBIDDEN = /[\\/:*?"<>|]|\p{Cc}/gu

/** A name with everything a file may not hold replaced by a space, rather than
 *  by nothing: `Plans: 2026` is a name somebody still recognises, where
 *  `Plans2026` is not. */
export function withoutForbidden(name: string): string {
  return name.replace(FORBIDDEN, ' ')
}

/** The `counter`th spelling of a path. One is the path itself; after that the
 *  number goes before the extension, so `a/Idea.md` becomes `a/Idea 2.md`.
 *
 *  The extension is the last dot of the file's own name and only there: a folder
 *  with a dot in it keeps its name, and a name that is nothing but an extension -
 *  `.hidden` - is a name rather than an extension of nothing. */
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

/** The first spelling of `path` nobody has: the path itself where it is free,
 *  else `path 2`, `path 3`... until one is.
 *
 *  `taken` is asked rather than handed a set, because each caller holds what is
 *  taken in its own way - a space's own listing, an import's own names, and two of
 *  the three ask case-insensitively, since two names differing only in case are
 *  one name on Windows and on a Mac. */
export function freePath(path: string, taken: (candidate: string) => boolean): string {
  for (let counter = 1; ; counter += 1) {
    const candidate = numbered(path, counter)
    if (!taken(candidate)) return candidate
  }
}
