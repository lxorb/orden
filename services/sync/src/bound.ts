/** Asking a query about a list of ids, inside what one statement may bind.
 *
 *  D1 refuses a statement with more than a hundred bound parameters. Every query
 *  here that says `in (?, ?, ?...)` grows that list with what an account holds - a
 *  rail of spaces, the PDFs beside a space's notes, the notes a purge is emptying -
 *  so each of them had a size at which it stopped working, and the tests never saw
 *  it: the SQLite they run against takes tens of thousands of parameters.
 *
 *  So the list is asked for a chunk at a time and the answers are joined. One
 *  place, because the alternative is four call sites each deciding the number for
 *  themselves and one of them getting it wrong; `test/bound.test.ts` holds every
 *  route to the ceiling rather than these functions to it. */

/** What D1 will bind in one statement. */
export const MOST_BOUND = 100

/** How many ids go into one statement by default: under the ceiling, with room
 *  for the handful of other parameters a query around the list may carry. A query
 *  that names its list more than once says so and gets a smaller number. */
export const AT_A_TIME = 80

/** The list in chunks, each one small enough to bind. */
export function chunks<T>(all: readonly T[], size = AT_A_TIME): T[][] {
  const pieces: T[][] = []
  for (let at = 0; at < all.length; at += size) pieces.push(all.slice(at, at + size))
  return pieces
}

/** Runs `ask` once per chunk and hands back every row all of them answered with.
 *  Sequentially, because a Worker has a ceiling on how many queries it may have
 *  in flight and a listing is not the place to spend it.
 *
 *  `size` is for a statement that binds the list more than once, or that carries
 *  other parameters beside it. */
export async function askInChunks<T>(
  ids: readonly string[],
  ask: (chunk: string[]) => Promise<T[]>,
  size = AT_A_TIME,
): Promise<T[]> {
  const found: T[] = []
  for (const chunk of chunks(ids, size)) found.push(...(await ask(chunk)))
  return found
}

/** `?, ?, ?` for a list of that length, to go inside an `in (...)`. Never built
 *  from anything but a length, so nothing a client sent reaches the SQL. */
export function places(many: number): string {
  return Array.from({ length: many }, () => '?').join(', ')
}
