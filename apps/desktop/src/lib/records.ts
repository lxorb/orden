/** Plain objects used as maps: icons by folder, keys by shortcut id, mirrors by
 *  space root.
 *
 *  `delete record[key]` is the obvious way to drop an entry and the wrong one
 *  for most of these. Several are reactive state, and Svelte follows a
 *  reassignment rather than a mutation of what is already there; the rest are
 *  written straight back to storage, where a fresh object is no more work than
 *  a changed one. So an entry goes by building the map again without it. */

export function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([one]) => one !== key))
}

/** `record` with `key` set, or with it dropped when the value is null. Both
 *  halves of "an icon, or no icon" in one place, since every caller wants
 *  exactly that pair. */
export function withOrWithout<T>(
  record: Record<string, T>,
  key: string,
  value: T | null,
): Record<string, T> {
  return value === null ? without(record, key) : { ...record, [key]: value }
}
