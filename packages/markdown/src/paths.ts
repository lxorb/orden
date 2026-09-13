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

/** Where the other side's copy of a note goes when both copies are kept.
 *
 *  The date rather than a number: a second copy of the same note on the same day is
 *  rare, and a name with a date in it says what it is in a file list sorted by name.
 *  One that is taken anyway steps aside by number like any other name; see
 *  `numbered` above.
 *
 *  Here for the same reason the rest of this file is: three things keep such a copy
 *  now - a pass that found two copies of a note, a reader answering the sync pane,
 *  and a room about to write its own words over a note that something which could
 *  not reach the room wrote - and two of them are in the app while the third is in
 *  the service. A reader who sees two spellings of the same thing cannot tell that
 *  they mean the same thing. See apps/desktop/src/lib/sync/conflicts.ts and
 *  `keptBeside` in services/sync/src/rooms/room.ts. */
export function conflictPath(path: string, on = new Date()): string {
  const stamp = on.toISOString().slice(0, 10)
  return path.replace(/(\.[^./\\]+)$/u, ` (from another device ${stamp})$1`)
}
