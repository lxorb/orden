/** What the account is sent while a settings file holds a setting (#673): the reader's
 *  own value, never the file's. A file is this machine's configuration; another device
 *  taking it through the account would be the file reaching a machine that never
 *  declared it. Every store's settings go up through `saveSettings` (api/routes.ts),
 *  which passes each patch through `shareable`, so this is the one place that knows. */

/** For each setting of the account a file holds part or all of: what puts the reader's
 *  own value back into what a store was about to send. */
const instead = new Map<string, ((value: unknown) => unknown)[]>()

/** From now on, `key` is sent through `fix` on its way to the account. */
export function sendInstead(key: string, fix: (value: unknown) => unknown): void {
  instead.set(key, [...(instead.get(key) ?? []), fix])
}

/** Nothing held: what the stores say goes up as they say it. */
export function sendAsSaid(): void {
  instead.clear()
}

/** `patch` as the account is to have it: each held setting the reader's own. */
export function shareable<T extends object>(patch: T): T {
  if (!instead.size) return patch
  const sent = { ...patch } as Record<string, unknown>
  for (const [key, fixes] of instead) {
    if (key in sent) sent[key] = fixes.reduce((value, fix) => fix(value), sent[key])
  }
  return sent as T
}
