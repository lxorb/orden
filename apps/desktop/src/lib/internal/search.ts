import type { FuzzyHit } from '@orden/scan/search/fuzzy'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import type { Warmth } from '../search/warmth'
import { joinPath } from '../platform/src/api'
import { type Mounted, mountOf } from './roots'

const following = new WeakSet<Mounted>()

async function follow(mount: Mounted) {
  if (following.has(mount)) return
  following.add(mount)
  const { space } = await import('../web/space-cache')
  mount.folder.heard((changes) => {
    for (const change of changes) {
      const at = `${mount.web}/${change.path}`
      if (change.dir && change.kind !== 'created') space.forget(null)
      else if (change.kind === 'renamed') {
        space.gone(`${mount.web}/${change.from}`)
        void space.rewritten(at)
      } else if (change.kind === 'removed') space.gone(at)
      else if (!change.dir) void space.rewritten(at)
    }
  })
}

function addressOf(root: string): { mount: Mounted; web: string } | null {
  const found = mountOf(root)
  if (!found) return null
  return {
    mount: found.mount,
    web: found.inside ? `${found.mount.web}/${found.inside}` : found.mount.web,
  }
}

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

export async function warmInternal(root: string): Promise<Warmth | null> {
  const at = addressOf(root)
  if (!at) return null
  await follow(at.mount)
  const { space } = await import('../web/space-cache')
  await space.fill(at.web)
  return space.warmth()
}
