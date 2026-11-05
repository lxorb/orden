/** Searching a space Orden keeps itself (#1068, step 4c): the browser build's walk over
 *  the rows (web/search.ts), on this thread, since the folder is this window's and the
 *  crate's own walk reads a folder this space does not have. What is held between two
 *  questions (web/space-cache.ts) follows the folder's own word on every change, as the
 *  browser's follows its rows, and every hit is said at the path the app holds. */

import type { FuzzyHit } from '../search/fuzzy'
import type { Hit } from '../search/match'
import type { Query } from '../search/query'
import type { Warmth } from '../search/warmth'
import { joinPath } from '../tauri'
import { type Mounted, mountOf } from './roots'

/** The spaces whose changes the held space already follows. */
const following = new WeakSet<Mounted>()

/** The held space told of every change to `mount`'s folder, once. */
async function follow(mount: Mounted) {
  if (following.has(mount)) return
  following.add(mount)
  const { space } = await import('../web/space-cache')
  mount.folder.heard((changes) => {
    for (const change of changes) {
      const at = `${mount.web}/${change.path}`
      // A folder that moved or went takes what is under it, which is read again.
      if (change.dir && change.kind !== 'created') space.forget(null)
      else if (change.kind === 'renamed') {
        space.gone(`${mount.web}/${change.from}`)
        void space.rewritten(at)
      } else if (change.kind === 'removed') space.gone(at)
      else if (!change.dir) void space.rewritten(at)
    }
  })
}

/** Where `root` is for the browser's commands, or null where it is in no kept space. */
function addressOf(root: string): { mount: Mounted; web: string } | null {
  const found = mountOf(root)
  if (!found) return null
  return {
    mount: found.mount,
    web: found.inside ? `${found.mount.web}/${found.inside}` : found.mount.web,
  }
}

/** Every hit of a query in the kept space at `root`, as `searchSpace` hands them over.
 *  Answers false where `root` is in none, for the crate to search. */
export async function searchInternal(
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: { hits: Hit[]; loose: FuzzyHit[] }) => void,
  excluded: readonly string[],
): Promise<boolean> {
  const at = addressOf(root)
  if (!at) return false
  await follow(at.mount)
  const out = <T extends { path: string }>(hit: T): T => {
    const inside = hit.path.startsWith(`${at.mount.web}/`)
      ? hit.path.slice(at.mount.web.length + 1)
      : ''
    return inside ? { ...hit, path: joinPath(at.mount.root, inside) } : hit
  }
  const { searchRows } = await import('../web/search')
  await searchRows(
    at.web,
    query,
    terms,
    limit,
    (found) => {
      onFound({ hits: found.hits.map(out), loose: found.loose.map(out) })
    },
    excluded,
  )
  return true
}

/** The kept space at `root` read and held, and what is held: `warm_search` for it.
 *  Null where `root` is in none. */
export async function warmInternal(root: string): Promise<Warmth | null> {
  const at = addressOf(root)
  if (!at) return null
  await follow(at.mount)
  const { space } = await import('../web/space-cache')
  await space.fill(at.web)
  return space.warmth()
}
