import { mirrorsFor } from '../../sync-mirror/src/api'
import { samePath } from '../../platform/src/api'

export interface V1Pair {
  root: string
  spaceId: string
  role: string
}
export function pairsFromV1(
  saved: unknown,
  accountId: string,
  local: readonly string[],
  remote: readonly { id: string; role: string }[],
  paired: readonly { root: string; spaceId: string }[],
): V1Pair[] {
  const roots = paired.map((one) => one.root)
  const spaces = new Set(paired.map((one) => one.spaceId))
  const out: V1Pair[] = []
  for (const [kept, mirror] of Object.entries(mirrorsFor(saved, accountId))) {
    const space = remote.find((candidate) => candidate.id === mirror.spaceId)
    const root = local.find((here) => samePath(here, kept))
    if (!space || root === undefined) continue
    if (roots.some((had) => samePath(had, root)) || spaces.has(mirror.spaceId)) continue
    roots.push(root)
    spaces.add(mirror.spaceId)
    out.push({ root, spaceId: mirror.spaceId, role: space.role })
  }
  return out
}
