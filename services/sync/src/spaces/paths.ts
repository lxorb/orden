/** What a path may be, in the columns a client writes whole.
 *
 *  A bookmark, a folder icon, an exclusion and a kept file are all a path relative
 *  to a space, written here by one client and read back by another. So a path in
 *  one of those columns has to be a path every machine can resolve the same way:
 *  not one that starts at the root of somebody's disk, not one written with the
 *  separator Windows writes, and not one that climbs out of the space with `..`.
 *  The app judges the same three things at its end - see `insideItsSpace` in
 *  apps/desktop/src/lib/space-paths.ts - and the two have to agree, because a
 *  column the service accepts is a column the app will resolve against a folder.
 *
 *  Four columns had written these three clauses out, in four spellings. What each
 *  of them says about a path it refuses stays its own: the sentence names the thing
 *  - a bookmark, a file - and the app shows it. */

/** How long a path a column keeps. The app holds itself to the same number, so a
 *  path that fits there fits here. */
export const LONGEST_PATH = 300

/** A drive letter at the front, which is where a path on somebody's own disk
 *  begins when it is written with the separator the web uses: `C:/Users/…`. Only
 *  at the front: a colon further along is a character in a name, which is a name
 *  Windows will not take but is nobody's disk. */
const A_DISK = /^[A-Za-z]:/

/** Whether a path stays inside its own space.
 *
 *  Only what makes a path resolvable in the same place on every machine. How long
 *  a path may be, and whether an empty one counts, are each column's own: a
 *  bookmark of the space itself has no path at all, while a file without one is
 *  nothing.
 *
 *  The three clauses used to be a leading slash, a backslash and a `..` segment,
 *  which left `C:/Windows/System32/x.pdf` reading as a path inside a space -
 *  something this module's own first paragraph says is refused, and something no
 *  machine but one could resolve. Nothing joins these onto a root in a way that
 *  would have followed it, which is why it was a false sentence rather than a way
 *  out of a folder; one caller written with a resolving join would have made it
 *  one. Control characters go for the same reason a note's path has none: a path
 *  is a name, and a name with a newline in it is two names to whatever reads it
 *  next. */
export function staysInside(path: string): boolean {
  return (
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !A_DISK.test(path) &&
    !/\p{Cc}/u.test(path) &&
    !path.split('/').includes('..')
  )
}
