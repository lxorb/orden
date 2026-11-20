import { invoke, isRecord, keepJson, samePath, stored } from '../../platform/src/api'

const KEY = 'orden:spaces-deleted'
interface Deleted {
  root: string
  back?: string
}
function deletedNow(): Deleted[] {
  const saved = stored(KEY)
  if (!Array.isArray(saved)) return []
  return saved.flatMap((one) =>
    isRecord(one) && typeof one.root === 'string'
      ? [{ root: one.root, ...(typeof one.back === 'string' ? { back: one.back } : {}) }]
      : [],
  )
}
export function spaceDeleted(root: string, back?: string): void {
  const rest = deletedNow().filter((one) => !samePath(one.root, root))
  keepJson(KEY, [{ root, ...(back === undefined ? {} : { back }) }, ...rest].slice(0, 64))
}
export async function undeleted<T extends { path: string }>(
  spaces: readonly { root: string }[],
  found: T[],
): Promise<T[]> {
  const listed = deletedNow().filter(
    (one) =>
      found.some((entry) => samePath(entry.path, one.root)) && !spaces.some((space) => samePath(space.root, one.root)),
  )
  const trashed = listed.some((one) => one.back !== undefined)
    ? await invoke<{ id: string }[]>('list_trash').catch(() => null)
    : null
  const still = listed.filter(
    (one) => one.back === undefined || !trashed || trashed.some((held) => held.id === one.back),
  )
  keepJson(KEY, still.length ? still : null)
  return found.filter((entry) => !still.some((one) => samePath(one.root, entry.path)))
}
