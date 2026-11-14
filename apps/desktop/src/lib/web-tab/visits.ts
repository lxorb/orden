import { isNumber, isRecord, isString } from '../platform/src/api'
import { isWebAddress } from './address'

export const MOST_VISITS = 2000

const LONGEST_ADDRESS = 2048

const LONGEST_TITLE = 200

export interface Visit {
  url: string
  title: string
  visits: number
  typed: number
  last: number
}

export function visitKey(url: string): string | null {
  if (url.length > LONGEST_ADDRESS || !isWebAddress(url)) return null

  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

function readVisit(value: unknown): Visit | null {
  if (!isRecord(value)) return null

  const { url, title, visits, typed, last } = value
  if (!isString(url) || !isNumber(visits) || !isNumber(typed) || !isNumber(last)) return null

  const key = visitKey(url)
  if (key === null) return null

  return { url: key, title: isString(title) ? title : '', visits, typed, last }
}

export function visitsFrom(value: unknown): Visit[] {
  if (!Array.isArray(value)) return []

  return bounded(value.map(readVisit).filter((one) => one !== null))
}

export function bounded(list: Visit[]): Visit[] {
  if (list.length <= MOST_VISITS) return list

  return [...list].sort((one, other) => other.last - one.last).slice(0, MOST_VISITS)
}

function touched(
  list: readonly Visit[],
  url: string,
  change: (was: Visit) => Visit,
): readonly Visit[] {
  const key = visitKey(url)
  if (key === null) return list

  const at = list.findIndex((one) => one.url === key)
  if (at >= 0) return list.map((one, index) => (index === at ? change(one) : one))

  return bounded([...list, change({ url: key, title: '', visits: 0, typed: 0, last: 0 })])
}

function titled(title: string, was: string): string {
  const said = title.trim().slice(0, LONGEST_TITLE)
  return said || was
}

export function visited(
  list: readonly Visit[],
  url: string,
  title: string,
  now: number,
): readonly Visit[] {
  return touched(list, url, (was) => ({
    ...was,
    title: titled(title, was.title),
    visits: was.visits + 1,
    last: now,
  }))
}

export function named(list: readonly Visit[], url: string, title: string): readonly Visit[] {
  const said = titled(title, '')
  const key = visitKey(url)
  if (!said || key === null || !list.some((one) => one.url === key && one.title !== said)) {
    return list
  }

  return touched(list, url, (was) => ({ ...was, title: said }))
}

export function typedTo(list: readonly Visit[], url: string, now: number): readonly Visit[] {
  return touched(list, url, (was) => ({ ...was, typed: was.typed + 1, last: now }))
}

export function broughtIn(list: readonly Visit[], rows: readonly Visit[]): readonly Visit[] {
  if (!rows.length) return list

  const kept = new Map(list.map((one) => [one.url, one]))
  for (const row of rows) {
    const was = kept.get(row.url)
    kept.set(
      row.url,
      was
        ? {
            ...was,
            title: was.title || titled(row.title, ''),
            visits: Math.max(was.visits, row.visits),
            typed: Math.max(was.typed, row.typed),
            last: Math.max(was.last, row.last),
          }
        : { ...row, title: titled(row.title, '') },
    )
  }
  return bounded([...kept.values()])
}

export function unvisited(list: readonly Visit[], url: string): readonly Visit[] {
  const key = visitKey(url)
  return list.filter((one) => one.url !== key)
}

export function unvisitedSince(list: readonly Visit[], since: number): readonly Visit[] {
  return since <= 0 ? [] : list.filter((one) => one.last < since)
}
