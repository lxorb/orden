import { foldName } from '@orden/markdown/links'
import type { Context, Row, Value } from './types'

export type LinkContext = Required<Pick<Context, 'resolve' | 'row' | 'backlinks'>>

interface Held {
  row: Row
  folded: string
}

interface Lookups {
  byPath: Map<string, Row>
  folded: Map<string, Row>
  byName: Map<string, Held[]>
  byAlias: Map<string, Held[]>
  shallowest: Map<string, Row | null>
  linking: Map<string, string[]>
}

const OWN = /\.(md|markdown|mdown|mkd)$/i

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const comparable = (path: string): string => foldName(path.replace(/\\/g, '/').replace(OWN, ''))

const lastOf = (folded: string): string => folded.slice(folded.lastIndexOf('/') + 1)

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

const keyOf = (space: string, path: string) => `${space}\n${path}`

function before(one: Held, other: Held): boolean {
  const depth = (held: Held) => held.row.path.split('/').length
  return depth(one) - depth(other) < 0 || (depth(one) === depth(other) && one.row.path < other.row.path)
}

function aliasesOf(row: Row): string[] {
  const value: Value | undefined = row.note.aliases
  const listed = Array.isArray(value) ? value : [value]
  return listed.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
}

function gathered<T>(map: Map<string, T[]>, key: string, one: T) {
  const held = map.get(key)
  if (held) held.push(one)
  else map.set(key, [one])
}

function nearestOf(found: readonly Held[], here: string): Row | undefined {
  let best: Held | undefined
  for (const held of found) {
    if (folderOf(held.row.path) === here) return held.row
    if (!best || before(held, best)) best = held
  }
  return best?.row
}

function reached(look: Lookups, target: string, from: Row): Row | undefined {
  const written = (target.split('#')[0] ?? target).trim().replace(/\\/g, '/')
  if (!written) return undefined

  const exact = (path: string) => look.folded.get(keyOf(from.space, comparable(path)))
  const here = folderOf(from.path)
  if (/^\.\.?\//.test(written)) return exact(within(here, written))
  if (written.startsWith('/')) return exact(within('', written))
  if (OWN.test(written)) {
    const beside = exact(within(here, written))
    if (beside) return beside
  }

  const wanted = comparable(written)
  const name = lastOf(wanted)
  const matches = (folded: string) => folded === wanted || folded.endsWith(`/${wanted}`)
  const beside = exact(here ? `${here}/${name}` : name)
  if (beside && matches(comparable(beside.path))) return beside

  const cached = keyOf(from.space, wanted)
  let best = look.shallowest.get(cached)
  if (best === undefined) {
    let found: Held | undefined
    for (const held of look.byName.get(keyOf(from.space, name)) ?? []) {
      if (matches(held.folded) && (!found || before(held, found))) found = held
    }
    best = found?.row ?? null
    look.shallowest.set(cached, best)
  }
  if (best) return best

  return nearestOf(look.byAlias.get(cached) ?? [], here)
}

function lookups(rows: readonly Row[]): Lookups {
  const look: Lookups = {
    byPath: new Map(),
    folded: new Map(),
    byName: new Map(),
    byAlias: new Map(),
    shallowest: new Map(),
    linking: new Map(),
  }

  for (const row of rows) {
    if (row.kind !== 'note') continue
    const folded = comparable(row.path)
    look.byPath.set(keyOf(row.space, row.path), row)
    if (!look.folded.has(keyOf(row.space, folded))) look.folded.set(keyOf(row.space, folded), row)
    gathered(look.byName, keyOf(row.space, lastOf(folded)), { row, folded })
    for (const alias of aliasesOf(row)) {
      gathered(look.byAlias, keyOf(row.space, comparable(alias)), { row, folded })
    }
  }
  for (const row of rows) {
    if (row.kind !== 'note') continue
    const reaches = new Set<string>()
    for (const target of row.file.links) {
      if (SCHEME.test(target)) continue
      const found = reached(look, target, row)
      if (found) reaches.add(keyOf(found.space, found.path))
    }
    for (const key of reaches) gathered(look.linking, key, row.path)
  }
  return look
}

export function linkContext(rows: readonly Row[]): LinkContext {
  let made: Lookups | null = null
  const look = () => (made ??= lookups(rows))

  return {
    resolve: (target, from) => (SCHEME.test(target) ? null : (reached(look(), target, from)?.path ?? null)),
    row: (path, space) => look().byPath.get(keyOf(space, path)),
    backlinks: (row) => look().linking.get(keyOf(row.space, row.path)) ?? [],
  }
}
