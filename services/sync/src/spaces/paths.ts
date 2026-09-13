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

/** Whether a path stays inside its own space.
 *
 *  Only those three clauses. How long a path may be, and whether an empty one
 *  counts, are each column's own: a bookmark of the space itself has no path at
 *  all, while a file without one is nothing. */
export function staysInside(path: string): boolean {
  return !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')
}
