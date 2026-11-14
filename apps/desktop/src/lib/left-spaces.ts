import { samePath, isRecord, isString, keepJson, recordOf, stored } from './platform/src/api'

const KEY = 'orden:left-spaces'

const MOST = 500

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
    marks = Object.fromEntries(Object.entries(marks).filter(([one]) => !samePath(one, root)))
    marks[root] = accountId
  }
  kept(marks)
}

export function forgetAccount(accountId: string) {
  const marks = held()
  const next = Object.fromEntries(Object.entries(marks).filter(([, by]) => by !== accountId))
  if (Object.keys(next).length !== Object.keys(marks).length) kept(next)
}

export function leftGone(root: string) {
  const marks = held()
  const next = Object.fromEntries(Object.entries(marks).filter(([one]) => !samePath(one, root)))
  if (Object.keys(next).length !== Object.keys(marks).length) kept(next)
}

export function leftMoved(from: string, to: string) {
  const marks = held()
  const by = markOf(marks, from)
  if (by === null) return
  const next = Object.fromEntries(Object.entries(marks).filter(([one]) => !samePath(one, from)))
  next[to] = by
  kept(next)
}
