import { insideItsSpace } from '../platform/src/api'
import { type Archive, type ArchiveMap, archiveMap, MOST_ARCHIVED } from './archive.svelte'

export function stampAfter(held: number | undefined, now: number): number {
  return Math.max(now, Math.abs(held ?? 0) + 1)
}

export function changed(
  map: ArchiveMap,
  archive: readonly string[],
  restore: readonly string[],
  now: number,
): ArchiveMap | null {
  const put = archive.filter((path) => insideItsSpace(path))
  const back = restore.filter((path) => (map[path] ?? 0) > 0)
  if (!put.length && !back.length) return null

  const next = { ...map }
  for (const path of put) next[path] = stampAfter(next[path], now)
  for (const path of back) next[path] = -stampAfter(next[path], now)
  return next
}

export const REMEMBERED = 30 * 24 * 60 * 60 * 1000

export function trimmed(map: ArchiveMap, now: number): ArchiveMap {
  const entries = Object.entries(map).filter(([, when]) => when > 0 || now + when < REMEMBERED)
  if (entries.length > MOST_ARCHIVED) {
    entries.sort(
      ([, one], [, other]) =>
        Number(one > 0) - Number(other > 0) || Math.abs(one) - Math.abs(other),
    )
    entries.splice(0, entries.length - MOST_ARCHIVED)
  }

  return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries)
}

export function merged(theirs: ArchiveMap, mine: ArchiveMap, now: number): ArchiveMap {
  const out: ArchiveMap = { ...theirs }
  for (const [path, when] of Object.entries(mine)) {
    const other = out[path]
    const later = other === undefined || Math.abs(when) > Math.abs(other)
    if (later || (Math.abs(when) === Math.abs(other) && when > other)) out[path] = when
  }

  return trimmed(archiveMap(out), now)
}

export function sameMap(one: ArchiveMap, other: ArchiveMap): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

export function fold(store: Archive, root: string, theirs: unknown, accountId: string) {
  const account = archiveMap(theirs)
  const mine = store.of(root)
  const met = merged(account, mine, Date.now())

  if (!sameMap(met, mine) || store.account(root) !== accountId) {
    store.put(root, sameMap(met, mine) ? mine : met, accountId)
  }
  if (!sameMap(met, account)) store.soon(root)
}

export async function send(store: Archive, root: string) {
  const { push } = await import('./pushing')
  await push(root, (api, token, spaceId) =>
    api.saveArchived(token, spaceId, trimmed(store.of(root), Date.now())),
  )
}
