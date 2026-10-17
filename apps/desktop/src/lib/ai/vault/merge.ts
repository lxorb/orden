/** What the vault holds, and how two devices' changes to it meet. Pure.
 *
 *  The vault is the AI accounts (accounts.ts), the API key of each that has one, and
 *  who each program or ChatGPT sign-in was signed in as on the device that saw it, so
 *  another device can show which account to sign in to. A program's sign-in itself
 *  never travels: Claude Code's and Codex's logins are their own (docs/ai.md).
 *
 *  Two devices change it at once now and then: a key typed on one while the other
 *  switched the account in use. So a merge is three-way, against the contents both
 *  last agreed on (`Base`): whatever one side changed since and the other did not is
 *  kept, a change on both sides goes to this device's, and an account removed on one
 *  side stays removed. The base remembers keys only by fingerprint, so a device keeps
 *  no second copy of a key outside its secret store. */

import { type Account, type Accounts, accountsIn, type Vendor } from '../accounts'

export interface Contents {
  accounts: Accounts
  /** API keys, by account id. */
  keys: Record<string, string>
  /** Who an account's sign-in was, by account id. */
  seen: Record<string, string>
}

/** The contents two sides last agreed on, keys by fingerprint. */
export interface Base {
  accounts: Accounts
  keys: Record<string, string>
  seen: Record<string, string>
}

/** One side of a merge: its contents, and its keys' fingerprints. */
export interface Side {
  contents: Contents
  prints: Record<string, string>
}

const EMPTY: Contents = {
  accounts: { accounts: [], active: {}, defaultVendor: '', uses: {} },
  keys: {},
  seen: {},
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One map merged three ways, a key at a time. `changed` says whether a side's value
 *  differs from the base's; absent on a side is a value too, the removal. */
function mergedMap<T, B>(
  base: Record<string, B> | null,
  local: Record<string, T>,
  remote: Record<string, T>,
  changedFrom: (side: 'local' | 'remote', id: string, value: T | undefined) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {}
  const ids = new Set([...Object.keys(remote), ...Object.keys(local)])
  for (const id of ids) {
    const mine = local[id]
    const theirs = remote[id]
    let kept: T | undefined
    if (!base) kept = theirs ?? mine
    else if (!(id in base)) kept = theirs ?? mine
    else kept = changedFrom('local', id, mine) ? mine : theirs
    if (kept !== undefined) out[id] = kept
  }
  return out
}

/** A value three ways: this side's where it changed, the other's otherwise. */
function mergedValue<T>(base: T | undefined, local: T, remote: T): T {
  if (base === undefined) return remote
  return same(local, base) ? remote : local
}

/** The accounts, in the other side's order with this side's new ones after. */
function mergedAccounts(base: Accounts | null, local: Accounts, remote: Accounts): Accounts {
  const byId = (list: readonly Account[]) => Object.fromEntries(list.map((one) => [one.id, one]))
  const baseById = base ? byId(base.accounts) : null
  const localById = byId(local.accounts)
  const merged = mergedMap(
    baseById,
    localById,
    byId(remote.accounts),
    (_, id, value) => !same(value, baseById?.[id]),
  )
  const order = [...remote.accounts, ...local.accounts]
    .map((one) => one.id)
    .filter((id, at, all) => all.indexOf(id) === at && id in merged)

  const records = <T>(pick: (one: Accounts) => Record<string, T>) =>
    mergedMap(
      base ? pick(base) : null,
      pick(local),
      pick(remote),
      (_, id, value) => !same(value, base ? pick(base)[id] : undefined),
    )
  return accountsIn({
    accounts: order.map((id) => merged[id]),
    active: records<string>((one) => one.active),
    defaultVendor: mergedValue<Vendor | undefined>(
      base?.defaultVendor,
      local.defaultVendor,
      remote.defaultVendor,
    ),
    uses: records<Vendor>((one) => one.uses),
  })
}

/** This device's contents and the other side's, met. */
export function merged(base: Base | null, local: Side, remote: Side): Contents {
  const accounts = mergedAccounts(
    base?.accounts ?? null,
    local.contents.accounts,
    remote.contents.accounts,
  )
  const ids = new Set(accounts.accounts.map((one) => one.id))
  const keys = mergedMap(
    base?.keys ?? null,
    local.contents.keys,
    remote.contents.keys,
    (side, id) => {
      const prints = side === 'local' ? local.prints : remote.prints
      return prints[id] !== base?.keys[id]
    },
  )
  const seen = mergedMap(
    base?.seen ?? null,
    local.contents.seen,
    remote.contents.seen,
    (_, id, value) => value !== base?.seen[id],
  )
  // Nothing is kept for an account neither side has any more.
  const only = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)))
  return { accounts, keys: only(keys), seen: only(seen) }
}

/** The base after two sides agree on `contents`. */
export function baseOf(contents: Contents, prints: Record<string, string>): Base {
  return { accounts: contents.accounts, keys: prints, seen: contents.seen }
}

/** Contents out of what a vault opened to, read rather than trusted. */
export function contentsIn(value: unknown): Contents {
  if (typeof value !== 'object' || value === null) return EMPTY
  const { accounts, keys, seen } = value as Record<string, unknown>
  const texts = (record: unknown): Record<string, string> =>
    typeof record === 'object' && record !== null
      ? Object.fromEntries(
          Object.entries(record).filter(
            (one): one is [string, string] => typeof one[1] === 'string',
          ),
        )
      : {}
  return { accounts: accountsIn(accounts), keys: texts(keys), seen: texts(seen) }
}

/** Whether two contents say the same, keys by fingerprint. */
export function agrees(
  base: Base | null,
  contents: Contents,
  prints: Record<string, string>,
): boolean {
  return !!base && same(baseOf(contents, prints), base)
}
