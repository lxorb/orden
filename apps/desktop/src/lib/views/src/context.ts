import type { Context, Row } from '@orden/bases'
import { foldName } from '@orden/markdown/links'
import { account } from '../../accounts/src/api'

interface Lookups {
  byPath: Map<string, Row>
  byName: Map<string, Row[]>
  linking: Map<string, string[]>
}

const OWN = /\.(md|markdown|mdown|mkd)$/i

function comparable(path: string): string {
  return foldName(path.replace(/\\/g, '/').replace(OWN, ''))
}

function nameOf(path: string): string {
  const folded = comparable(path)
  return folded.slice(folded.lastIndexOf('/') + 1)
}

function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

function within(folder: string, target: string): string {
  const parts = folder.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function nearer(one: Row, other: Row, here: string): Row {
  const beside = (row: Row) => (folderOf(row.path) === here ? 0 : 1)
  const depth = (row: Row) => row.path.split('/').length
  const order =
    beside(one) - beside(other) || depth(one) - depth(other) || (one.path < other.path ? -1 : 1)
  return order <= 0 ? one : other
}

const keyOf = (space: string, path: string) => `${space}\n${path}`

function reached(byName: Lookups['byName'], target: string, from: Row): Row | undefined {
  const written = (target.split('#')[0] ?? target).trim().replace(/\\/g, '/')
  if (!written) return undefined
  const named = byName.get(keyOf(from.space, nameOf(written)))
  if (!named) return undefined

  const at = (path: string) => named.find((row) => comparable(row.path) === comparable(path))
  const here = folderOf(from.path)
  if (/^\.\.?\//.test(written)) return at(within(here, written))
  if (written.startsWith('/')) return at(within('', written))
  if (OWN.test(written)) {
    const beside = at(within(here, written))
    if (beside) return beside
  }

  const wanted = comparable(written)
  let best: Row | undefined
  for (const row of named) {
    const path = comparable(row.path)
    if (path !== wanted && !path.endsWith(`/${wanted}`)) continue
    best = best ? nearer(best, row, here) : row
  }
  return best
}

function lookups(rows: readonly Row[]): Lookups {
  const byPath = new Map<string, Row>()
  const byName = new Map<string, Row[]>()
  const linking = new Map<string, string[]>()

  for (const row of rows) {
    if (row.kind !== 'note') continue
    byPath.set(keyOf(row.space, row.path), row)
    const name = keyOf(row.space, nameOf(row.path))
    const named = byName.get(name)
    if (named) named.push(row)
    else byName.set(name, [row])
  }
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const target of row.file.links) {
      const found = reached(byName, target, row)
      if (!found) continue
      const key = keyOf(found.space, found.path)
      const gathered = linking.get(key)
      if (gathered) gathered.push(row.path)
      else linking.set(key, [row.path])
    }
  }
  return { byPath, byName, linking }
}

export interface ContextStart {
  rows: readonly Row[]
  today: string
  now: string
  this?: Row | undefined
  search?: string
  me?: string | undefined
}

export function contextFor(start: ContextStart): Context {
  let made: Lookups | null = null
  const look = () => (made ??= lookups(start.rows))

  const context: Context = {
    today: start.today,
    now: start.now,
    resolve: (target, from) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
      return reached(look().byName, target, from)?.path ?? null
    },
    row: (path, space) => look().byPath.get(keyOf(space, path)),
    backlinks: (row) => look().linking.get(keyOf(row.space, row.path)) ?? [],
  }
  if (start.this) context.this = start.this
  if (start.search) context.search = start.search
  const me = start.me ?? account.name
  if (me) context.me = me
  return context
}
