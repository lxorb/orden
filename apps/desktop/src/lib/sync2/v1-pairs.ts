import { readMirror } from '../sync/mirror'
import { isRecord } from '../stored'

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
  const roots = new Set(paired.map((one) => one.root))
  const spaces = new Set(paired.map((one) => one.spaceId))
  const out: V1Pair[] = []
  for (const [root, one] of Object.entries(held)) {
    const mirror = readMirror(root, one)
    const space = mirror && remote.find((candidate) => candidate.id === mirror.spaceId)
    if (!mirror || !space || !local.includes(root)) continue
    if (roots.has(root) || spaces.has(mirror.spaceId)) continue
    roots.add(root)
    spaces.add(mirror.spaceId)
    out.push({ root, spaceId: mirror.spaceId, role: space.role })
  }
  return out
}
