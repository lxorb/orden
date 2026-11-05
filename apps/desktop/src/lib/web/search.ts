/** Searching a space in the browser: the same walk the crate does on a desktop,
 *  over the notes the worker is holding.
 *
 *  The query arrives already parsed and the matching itself is shared code, so
 *  the two builds cannot answer differently; what differs is only where the
 *  notes are. Its own module rather than a case in commands.ts because it is
 *  what the search worker runs, and a worker that pulled in the whole command
 *  surface would pull the app in behind it.
 *
 *  Where the notes come from is space-cache.ts: from memory once the space has
 *  been read, and from the store while it has not. Either way they arrive in path
 *  order, which is the order the desktop walks a space in, so the two builds fill
 *  a list the same way. */

import type { Query } from '@orden/scan/search/query'
import { type Found, walkSearch } from '@orden/scan/search/walk'
import { normalise } from './paths'
import { space } from './space-cache'

/** Searches every note under `root`, handing hits over as they are found: the walk
 *  every build shares (@orden/scan/search/walk), over the notes this worker holds.
 *  `excluded` are the notes and folders the space leaves out, relative to it; see
 *  workspace/excluded.svelte.ts. */
export async function searchRows(
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const base = normalise(root)
  await walkSearch((visit) => space.each(base, visit), query, terms, limit, onFound, excluded)
}
