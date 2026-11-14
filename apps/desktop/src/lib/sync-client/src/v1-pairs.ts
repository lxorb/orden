import { readMirror } from '../../sync/mirror'
import { samePath } from '../../platform/src/api'
import { isRecord } from './shape'

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
  if (!isRecord(saved)) return []
  if (typeof saved.account === 'string' && saved.account !== accountId) return []
  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  const roots = paired.map((one) => one.root)
  const spaces = new Set(paired.map((one) => one.spaceId))
  const out: V1Pair[] = []
  for (const [kept, one] of Object.entries(held)) {
    const mirror = readMirror(kept, one)
    const space = mirror && remote.find((candidate) => candidate.id === mirror.spaceId)
    const root = local.find((here) => samePath(here, kept))
    if (!mirror || !space || root === undefined) continue
    if (roots.some((had) => samePath(had, root)) || spaces.has(mirror.spaceId)) continue
    roots.push(root)
    spaces.add(mirror.spaceId)
    out.push({ root, spaceId: mirror.spaceId, role: space.role })
  }
  return out
}
