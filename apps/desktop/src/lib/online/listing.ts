import { nameOf } from '../platform/src/api'
import { programTitle } from '../terminal/naming'
import type { Listed } from './calls'
import { termName } from './path'

export interface SessionRow {
  key: string
  name: string | null
  file: string | null
  at: number | null
  listed: Listed
}

export function rowOf(one: Listed): SessionRow {
  const file = one.path === null ? null : termName(nameOf(one.path))
  const title = one.program !== null && one.title !== null ? programTitle(one.title) : null
  const name = title ?? one.program ?? file
  return {
    key: one.session,
    name,
    file: file !== null && file !== name ? file : null,
    at: one.at ?? one.createdAt,
    listed: one,
  }
}

export function rowsOf(listed: readonly Listed[]): SessionRow[] {
  const heard = (one: Listed) => one.at ?? -1
  return [...listed]
    .sort((a, b) => heard(b) - heard(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map(rowOf)
}

export function opens(one: Listed): boolean {
  return one.term !== null && one.path !== null && !one.trashed
}
