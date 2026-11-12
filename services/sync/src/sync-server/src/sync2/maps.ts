import { Hono } from 'hono'
import { byteLength, newId, now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { mayChangeTree } from '../limits'
import { NOT_AN_OBJECT, TOO_MANY_CHANGES } from '../refused'
import { bookmarkId, readBookmarks } from '../spaces/bookmarks'
import { MOST_BYTES } from '../spaces/columns'
import { readExcluded } from '../spaces/excluded'
import { readGraph } from '../spaces/graph'
import { readIcons, readTints } from '../spaces/icons'
import { readArranged } from '../spaces/arranged'
import { atLeast, spaceOf } from '../spaces/space'
import type { Env, Space, Variables } from '../types'
import { deviceOf, whoseId } from './device'
import { readTree, type Tree } from './tree'

export type MapName = 'bookmark' | 'icon' | 'order' | 'graph' | 'excluded'
const MAPS: readonly MapName[] = ['bookmark', 'icon', 'order', 'graph', 'excluded']

export interface Entry {
  map: MapName
  key: string
  value: unknown
}

interface Kept extends Entry {
  seq: number
  at: number
}

const LONGEST_KEY = 512
const MOST_CHANGED = 200
const PAGE = 1000
const MOST_ENTRIES = 10_000

const PATH = 'path:'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unplaced(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'at'))
}

function holds(map: MapName, key: string, value: unknown): boolean {
  if (value === null) return true
  switch (map) {
    case 'bookmark':
      if (!isRecord(value) || !isPosition(value.at)) return false
      return readBookmarks(JSON.stringify([unplaced(value)])).length === 1
    case 'icon': {
      if (!isRecord(value) || typeof value.icon !== 'string') return false
      const icon = readIcons(JSON.stringify({ x: value.icon }))
      if (!('x' in icon)) return false
      if (value.tint === undefined) return true
      return typeof value.tint === 'string' && 'x' in readTints(JSON.stringify({ x: value.tint }))
    }
    case 'order':
      return isPosition(value)
    case 'graph':
      return Object.hasOwn(readGraph(JSON.stringify({ [key]: value })), key)
    case 'excluded':
      return value === true && readExcluded(JSON.stringify([key])).includes(key)
  }
}

function entryOf(value: unknown): Entry | null {
  if (!isRecord(value)) return null
  const { map, key } = value
  const name = MAPS.find((one) => one === map)
  if (!name || typeof key !== 'string' || !key || key.length > LONGEST_KEY) return null
  const held = value.value === undefined ? null : value.value
  return holds(name, key, held) ? { map: name, key, value: held } : null
}

type Child = ReturnType<Tree['lookup']>

function folderAt(child: Child, path: string): string | null {
  let parent: string | null = null
  for (const name of path.split('/')) {
    const found = child(parent, name)
    if (found?.kind !== 'folder') return null
    parent = found.id
  }
  return parent
}

function pathOfKey(tree: Tree, key: string): string | null {
  if (key.startsWith(PATH)) return key.slice(PATH.length)
  const entry = tree.entry(key)
  return entry && !entry.deleted ? tree.pathOf(key) : null
}

const POINTS_AT_AN_ENTRY = new Set(['note', 'folder', 'heading', 'block'])

function locatedBookmark(tree: Tree, value: Record<string, unknown>): Record<string, unknown> {
  const id = bookmarkId(value.id)
  const path = value.path
  if (!id || typeof path !== 'string' || !POINTS_AT_AN_ENTRY.has(String(value.kind))) return value
  const entry = tree.entry(id)
  if (!entry || entry.deleted) return value
  const cut = value.kind === 'block' ? path.indexOf('#') : -1
  const file = cut === -1 ? path : path.slice(0, cut)
  const now = tree.pathOf(id)
  return now === file ? value : { ...value, path: now + path.slice(file.length) }
}

function projected(entries: readonly Kept[], tree: Tree): Record<string, string> {
  const of = (map: MapName) => entries.filter((one) => one.map === map && one.value !== null)

  const bookmarks = of('bookmark')
    .map((one) => one.value as Record<string, unknown>)
    .sort((a, b) => Number(a.at) - Number(b.at))
    .map(unplaced)
    .map((one) => locatedBookmark(tree, one))

  const icons: Record<string, string> = {}
  const tints: Record<string, string> = {}
  for (const one of of('icon')) {
    const path = pathOfKey(tree, one.key)
    const value = one.value as { icon: string; tint?: string }
    if (path === null) continue
    icons[path] = value.icon
    if (value.tint !== undefined) tints[path] = value.tint
  }

  const places = new Map<string, { name: string; at: number }[]>()
  for (const one of of('order')) {
    const placed = placeOf(tree, one.key)
    if (!placed) continue
    const list = places.get(placed.folder) ?? []
    list.push({ name: placed.name, at: one.value as number })
    places.set(placed.folder, list)
  }
  const arranged: Record<string, string[]> = {}
  for (const [folder, list] of places) {
    arranged[folder] = list.sort((a, b) => a.at - b.at).map((one) => one.name)
  }

  const graph: Record<string, unknown> = {}
  for (const one of of('graph')) graph[one.key] = one.value

  const excluded = of('excluded')
    .map((one) => one.key)
    .sort()

  return {
    bookmarks: JSON.stringify(readBookmarks(JSON.stringify(bookmarks))),
    icons: JSON.stringify(readIcons(JSON.stringify(icons))),
    tints: JSON.stringify(readTints(JSON.stringify(tints))),
    arranged: JSON.stringify(readArranged(JSON.stringify(arranged))),
    graph: JSON.stringify(readGraph(JSON.stringify(graph))),
    excluded: JSON.stringify(readExcluded(JSON.stringify(excluded))),
  }
}

function placeOf(tree: Tree, key: string): { folder: string; name: string } | null {
  if (key.startsWith(PATH)) {
    const path = key.slice(PATH.length)
    const cut = path.lastIndexOf('/')
    return { folder: path.slice(0, Math.max(cut, 0)), name: path.slice(cut + 1) }
  }
  const entry = tree.entry(key)
  if (!entry || entry.deleted) return null
  return { folder: entry.parent === null ? '' : tree.pathOf(entry.parent), name: entry.name }
}

function fitting(columns: Record<string, string>): boolean {
  return (
    byteLength(columns.bookmarks ?? '') <= MOST_BYTES.bookmarks &&
    byteLength(columns.icons ?? '') + byteLength(columns.tints ?? '') <= MOST_BYTES.icons &&
    byteLength(columns.arranged ?? '') <= MOST_BYTES.arranged &&
    byteLength(columns.graph ?? '') <= MOST_BYTES.graph &&
    byteLength(columns.excluded ?? '') <= MOST_BYTES.excluded
  )
}

async function keptIn(env: Env, spaceId: string): Promise<Kept[]> {
  const { results } = await env.DB.prepare(
    'select map, key, value, seq, at from space_entries where space_id = ?',
  )
    .bind(spaceId)
    .all<{ map: MapName; key: string; value: string | null; seq: number; at: number }>()
  return results.map((row) => ({
    map: row.map,
    key: row.key,
    value: row.value === null ? null : (JSON.parse(row.value) as unknown),
    seq: row.seq,
    at: row.at,
  }))
}

function overlaid(
  kept: readonly Kept[],
  changes: readonly Entry[],
  seq: number,
  at: number,
): Kept[] {
  const byKey = new Map(kept.map((one) => [`${one.map}\u0000${one.key}`, one]))
  changes.forEach((one, index) => {
    byKey.set(`${one.map}\u0000${one.key}`, { ...one, seq: seq + index, at })
  })
  return [...byKey.values()]
}

async function writeAtBlock(
  env: Env,
  spaceId: string,
  changes: readonly Kept[],
  columns: Record<string, string> | null,
  by: string,
): Promise<number> {
  const many = changes.length
  const results = await env.DB.batch([
    env.DB.prepare(
      `insert into space_cursor (space_id, next) values (?1, ?2 + 1)
       on conflict(space_id) do update set next = next + ?2`,
    ).bind(spaceId, many),
    ...writing(env, spaceId, changes, columns, by, many),
    env.DB.prepare('select next - 1 as last from space_cursor where space_id = ?1').bind(spaceId),
  ])
  return (results.at(-1)?.results[0] as { last?: number } | undefined)?.last ?? many
}

function writing(
  env: Env,
  spaceId: string,
  changes: readonly Kept[],
  columns: Record<string, string> | null,
  by: string,
  many: number,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  for (let from = 0; from < changes.length; from += 200) {
    const piece = changes.slice(from, from + 200).map((one) => ({
      map: one.map,
      key: one.key,
      value: one.value === null ? null : JSON.stringify(one.value),
      seq: one.seq,
      at: one.at,
    }))
    out.push(
      env.DB.prepare(
        `insert into space_entries (space_id, map, key, value, seq, at, by)
         select ?1, json_extract(value, '$.map'), json_extract(value, '$.key'),
                json_extract(value, '$.value'),
                (select next from space_cursor where space_id = ?1) - ?4
                  + json_extract(value, '$.seq'),
                json_extract(value, '$.at'), ?2
           from json_each(?3) where true
         on conflict(space_id, map, key) do update
           set value = excluded.value, seq = excluded.seq, at = excluded.at, by = excluded.by`,
      ).bind(spaceId, by, JSON.stringify(piece), many),
    )
  }
  if (columns) {
    out.push(
      env.DB.prepare(
        `update spaces set bookmarks = ?1, icons = ?2, tints = ?3, arranged = ?4, graph = ?5,
                           excluded = ?6, updated_at = ?7
          where id = ?8`,
      ).bind(
        columns.bookmarks,
        columns.icons,
        columns.tints,
        columns.arranged,
        columns.graph,
        columns.excluded,
        now(),
        spaceId,
      ),
    )
  }
  return out
}

async function writeEntries(
  env: Env,
  spaceId: string,
  changes: readonly Entry[],
  by: string,
): Promise<number | null> {
  const [kept, tree] = [await keptIn(env, spaceId), await readTree(env, spaceId)]
  const at = now()
  const provisional = overlaid(kept, changes, 0, at)
  const columns = projected(provisional, tree)
  if (provisional.length > MOST_ENTRIES || !fitting(columns)) return null

  const stamped = changes.map((one, index) => ({ ...one, seq: index, at }))
  return await writeAtBlock(env, spaceId, stamped, columns, by)
}

export async function v1Wrote(env: Env, space: Space, map: MapName, value: unknown, by: string) {
  if (!space.prepared_at) return
  const [kept, tree] = [await keptIn(env, space.id), await readTree(env, space.id)]
  const mine = kept.filter((one) => one.map === map && one.value !== null)
  const said = entriesFromV1(map, value, tree, mine)

  const named = new Set(said.map((one) => one.key))
  const gone = mine
    .filter((one) => !named.has(one.key))
    .map((one) => ({ map, key: one.key, value: null }))
  const changes = [...said, ...gone]
  if (!changes.length) return

  const at = now()
  const stamped = changes.map((one, index) => ({ ...one, seq: index, at }))
  await writeAtBlock(env, space.id, stamped, null, by)
}

function entriesFromV1(map: MapName, value: unknown, tree: Tree, mine: readonly Kept[]): Entry[] {
  const child = tree.lookup()
  switch (map) {
    case 'bookmark': {
      const left = [...mine]
      return (Array.isArray(value) ? value : []).map((bookmark: unknown, index) => {
        const same = left.findIndex((one) =>
          sameBookmark(
            isRecord(one.value) ? locatedBookmark(tree, one.value) : one.value,
            bookmark,
          ),
        )
        const was = same >= 0 ? left.splice(same, 1)[0] : undefined
        const key = was?.key ?? newId()
        const kept = isRecord(was?.value) ? bookmarkId(was.value.id) : null
        const sent = isRecord(bookmark) ? bookmark : {}
        const id = bookmarkId(sent.id) ?? kept
        return { map, key, value: { ...sent, ...(id ? { id } : {}), at: index + 1 } }
      })
    }
    case 'icon': {
      const { icons, tints } = (isRecord(value) ? value : {}) as {
        icons?: Record<string, string>
        tints?: Record<string, string>
      }
      return Object.entries(icons ?? {}).map(([path, icon]) => {
        const folder = folderAt(child, path)
        const tint = tints?.[path]
        return {
          map,
          key: folder ?? `${PATH}${path}`,
          value: { icon, ...(tint === undefined ? {} : { tint }) },
        }
      })
    }
    case 'order': {
      const out: Entry[] = []
      for (const [folder, names] of Object.entries(isRecord(value) ? value : {})) {
        const parent = folder === '' ? null : folderAt(child, folder)
        ;(Array.isArray(names) ? names : []).forEach((name: unknown, index) => {
          if (typeof name !== 'string') return
          const placed = folder === '' || parent !== null ? child(parent, name) : undefined
          out.push({ map, key: placed?.id ?? `${PATH}${folder}/${name}`, value: index + 1 })
        })
      }
      return out
    }
    case 'graph':
      return Object.entries(isRecord(value) ? value : {}).map(([key, one]) => ({
        map,
        key,
        value: one,
      }))
    case 'excluded':
      return (Array.isArray(value) ? value : [])
        .filter((path): path is string => typeof path === 'string')
        .map((path) => ({ map, key: path, value: true }))
  }
}

function sameBookmark(kept: unknown, sent: unknown): boolean {
  if (!isRecord(kept) || !isRecord(sent)) return false
  return (['kind', 'path', 'text', 'parent', 'view'] as const).every(
    (field) => kept[field] === sent[field],
  )
}

export async function backfillMaps(env: Env, spaceId: string): Promise<void> {
  const space = await env.DB.prepare('select * from spaces where id = ?')
    .bind(spaceId)
    .first<Space>()
  if (!space) return
  const values: [MapName, unknown][] = [
    ['bookmark', readBookmarks(space.bookmarks)],
    ['icon', { icons: readIcons(space.icons), tints: readTints(space.tints) }],
    ['order', readArranged(space.arranged)],
    ['graph', readGraph(space.graph)],
    ['excluded', readExcluded(space.excluded)],
  ]
  for (const [map, value] of values) await v1Wrote(env, space, map, value, '')
}

function keyedBy(one: Kept): string | null {
  if (one.map === 'icon' || one.map === 'order') return one.key.startsWith(PATH) ? null : one.key
  if (one.map === 'bookmark' && isRecord(one.value)) return bookmarkId(one.value.id)
  return null
}

function moves(tree: Tree, placed: ReadonlySet<string>, id: string): boolean {
  const seen = new Set<string>()
  for (let at: string | null = id; at !== null && !seen.has(at);) {
    if (placed.has(at)) return true
    seen.add(at)
    at = tree.entry(at)?.parent ?? null
  }
  return false
}

export async function reproject(env: Env, spaceId: string, after: Tree): Promise<void> {
  const kept = await keptIn(env, spaceId)
  const keys = kept.flatMap((one) => {
    const key = one.value === null ? null : keyedBy(one)
    return key === null ? [] : [key]
  })
  if (!keys.length) return
  const placed = after.placed()
  if (!keys.some((key) => moves(after, placed, key))) return
  const columns = projected(kept, after)
  if (!fitting(columns)) return
  await env.DB.batch(writing(env, spaceId, [], columns, '', 0))
}

async function entriesSince(
  env: Env,
  spaceId: string,
  since: number,
): Promise<{ entries: Kept[]; cursor: number; more: boolean }> {
  const { results } = await env.DB.prepare(
    `select map, key, value, seq, at from space_entries
      where space_id = ? and seq > ? order by seq limit ?`,
  )
    .bind(spaceId, since, PAGE + 1)
    .all<{ map: MapName; key: string; value: string | null; seq: number; at: number }>()

  const page = results.slice(0, PAGE)
  return {
    entries: page.map((row) => ({
      map: row.map,
      key: row.key,
      value: row.value === null ? null : (JSON.parse(row.value) as unknown),
      seq: row.seq,
      at: row.at,
    })),
    cursor: page.at(-1)?.seq ?? since,
    more: results.length > PAGE,
  }
}

interface App {
  Bindings: Env
  Variables: Variables
}

function changesIn(body: unknown): Entry[] | null {
  if (!isRecord(body) || !Array.isArray(body.entries) || body.entries.length > MOST_CHANGED) {
    return null
  }
  const out: Entry[] = []
  for (const one of body.entries as unknown[]) {
    const entry = entryOf(one)
    if (!entry) return null
    out.push(entry)
  }
  return out
}

const NOT_AN_ENTRY = 'that is not an entry this space keeps'

const TOO_MUCH_ABOUT_THE_TREE = 'that is more than a space keeps about its tree'

export const v2Maps = new Hono<App>()

v2Maps.get('/:space/maps', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0
  return context.json(await entriesSince(context.env, space.id, since))
})

v2Maps.patch('/:space/maps', atLeast('write', 'space'), async (context) => {
  const space = spaceOf(context)
  const body: unknown = await context.req.json().catch(() => undefined)
  if (!isRecord(body)) return context.json({ error: NOT_AN_OBJECT }, 400)
  const changes = changesIn(body)
  if (!changes) return context.json({ error: NOT_AN_ENTRY }, 400)
  if (!(await mayChangeTree(context.env, whoseId(context.get('who'))))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }
  if (!changes.length) return context.json({ cursor: 0 })

  const device = await deviceOf(context)
  const cursor = await writeEntries(context.env, space.id, changes, device)
  if (cursor === null) {
    return context.json({ error: TOO_MUCH_ABOUT_THE_TREE }, 413)
  }
  await pokeSpace(context.env, laterOf(context), space.id, cursor, device)
  return context.json({ cursor })
})
