import { samePath, isRecord, isString, keepJson, recordOf, stored } from '../../platform/src/api'

const KEY = 'orden:left-spaces'

const HOMES = 'orden:space-homes'

const MOST = 500

interface Home {
  by: string
  space: string
}

const isHome = (value: unknown): value is Home =>
  isRecord(value) && isString(value.by) && isString(value.space)

function homes(): Record<string, Home> {
  const saved = stored(HOMES)
  return isRecord(saved) ? recordOf(saved, isHome) : {}
}

function keptHomes(next: Record<string, Home>) {
  keepJson(HOMES, Object.fromEntries(Object.entries(next).slice(-MOST)))
}

function others<T>(marks: Record<string, T>, root: string): Record<string, T> {
  return Object.fromEntries(Object.entries(marks).filter(([one]) => !samePath(one, root)))
}

function held(): Record<string, string> {
  const saved = stored(KEY)
  return isRecord(saved) ? recordOf(saved, isString) : {}
}

function kept(next: Record<string, string>) {
  keepJson(KEY, Object.fromEntries(Object.entries(next).slice(-MOST)))
}

function markOf(marks: Record<string, string>, root: string): string | null {
  for (const [one, by] of Object.entries(marks)) if (samePath(one, root)) return by
  return null
}

export function leftBy(root: string): string | null {
  return markOf(held(), root)
}

export function leftByAnother(root: string, accountId: string | null): boolean {
  const by = leftBy(root)
  return by !== null && by !== accountId
}

export function leaveSpaces(accountId: string, roots: readonly string[]) {
  let marks = held()
  for (const root of roots) {
    const by = markOf(marks, root)
    if (by !== null && by !== accountId) continue
    marks = others(marks, root)
    marks[root] = accountId
  }
  kept(marks)
}

export function keepHomes(
  accountId: string,
  pairs: readonly { readonly root: string; readonly spaceId: string }[],
) {
  let next = homes()
  const before = JSON.stringify(next)
  for (const { root, spaceId } of pairs) {
    if (leftByAnother(root, accountId)) continue
    next = Object.fromEntries(
      Object.entries(others(next, root)).filter(
        ([, home]) => home.by !== accountId || home.space !== spaceId,
      ),
    )
    next[root] = { by: accountId, space: spaceId }
  }
  if (JSON.stringify(next) !== before) keptHomes(next)
}

export function homeOf(root: string, accountId: string | null): string | null {
  if (accountId === null) return null
  for (const [one, home] of Object.entries(homes())) {
    if (samePath(one, root)) return home.by === accountId ? home.space : null
  }
  return null
}

export function forgetHome(root: string) {
  const all = homes()
  const next = others(all, root)
  if (Object.keys(next).length !== Object.keys(all).length) keptHomes(next)
}

export function forgetAccount(accountId: string) {
  const marks = held()
  const next = Object.fromEntries(Object.entries(marks).filter(([, by]) => by !== accountId))
  if (Object.keys(next).length !== Object.keys(marks).length) kept(next)
}

export function leftGone(root: string) {
  const marks = held()
  const next = others(marks, root)
  if (Object.keys(next).length !== Object.keys(marks).length) kept(next)
  forgetHome(root)
}

export function leftMoved(from: string, to: string) {
  const all = homes()
  const home = Object.entries(all).find(([one]) => samePath(one, from))?.[1]
  if (home) keptHomes({ ...others(all, from), [to]: home })
  const marks = held()
  const by = markOf(marks, from)
  if (by === null) return
  const next = others(marks, from)
  next[to] = by
  kept(next)
}
