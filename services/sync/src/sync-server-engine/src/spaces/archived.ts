import { LONGEST_PATH, objectIn, staysInside } from '../../../sync-server/src/api'
import { columnRoute } from './space'

const MOST = 1000
function kept(path: string, when: unknown): when is number {
  return (
    path.length > 0 &&
    path.length <= LONGEST_PATH &&
    staysInside(path) &&
    typeof when === 'number' &&
    Number.isSafeInteger(when) &&
    when !== 0
  )
}
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'archived must be a map'
  if (Object.keys(value).length > MOST) return `a space keeps at most ${MOST} archived paths`
  return null
}
function archivedMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: [string, number][] = []
  for (const [path, when] of Object.entries(value)) {
    if (out.length >= MOST) break
    if (kept(path, when)) out.push([path, when])
  }
  return Object.fromEntries(out)
}
export function readArchived(raw: string): Record<string, number> {
  return archivedMap(objectIn(raw))
}
export const spaceArchived = columnRoute(
  'archived',
  wrong,
  archivedMap,
  'that is more archived paths than a space holds',
)
