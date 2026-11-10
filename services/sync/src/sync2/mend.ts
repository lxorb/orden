import { uncounted } from '@orden/markdown/paths'
import { nameKey, type Op } from '@orden/sync-core'
import { metaFromText } from '@orden/sync-core/meta'
import { newId, now, sha256 } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { noteKey } from '../notes'
import { protectLikewise } from '../protected'
import { ingestInto } from '../rooms'
import type { Reached } from '../spaces/space'
import type { Env, Note } from '../types'
import { keepVersionNow } from '../versions'
import { reproject } from './maps'
import { applyOps } from './ops'
import { DOCUMENT_KINDS } from './tree'

const MENDER = 'mend'

const SAME_BATCH = 2

const EDITED_AFTER = 60_000

interface Item {
  id: string
  folder: boolean
  kind: string
  parent: string | null
  name: string
  seq: number
  hash: string
  size: number
  version: number
  updated_at: number
  meta: string | null
}

interface Made {
  id: string
  at: number
}

interface Pair {
  keep: string
  drop: string
}

interface Mending {
  pairs: Pair[]
  moved: string[]
  versions: number
  protected: number
}

function nameFrom(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  return `${uncounted(stem)}${extension}`
}

type Later = ReturnType<typeof laterOf>

type Row = Omit<Item, 'folder'> & { folder: number }

async function liveItems(env: Env, spaceId: string): Promise<Item[]> {
  const notes = await env.DB.prepare(
    `select id, 0 as folder, kind, folder_id as parent, name, seq, hash, size, version, updated_at, meta
       from notes where space_id = ? and deleted = 0 and name is not null`,
  )
    .bind(spaceId)
    .all<Row>()
  const folders = await env.DB.prepare(
    `select id, 1 as folder, 'folder' as kind, parent_id as parent, name, seq, '' as hash, 0 as size,
            0 as version, updated_at, meta
       from folders where space_id = ? and deleted = 0`,
  )
    .bind(spaceId)
    .all<Row>()
  return [...notes.results, ...folders.results].map((one) => ({ ...one, folder: one.folder === 1 }))
}

async function madeInBatches(env: Env, spaceId: string): Promise<Map<number, Made[]>> {
  const { results } = await env.DB.prepare('select result, at from tree_ops where space_id = ?')
    .bind(spaceId)
    .all<{ result: string; at: number }>()
  const out = new Map<number, Made[]>()
  for (const row of results) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.result)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const { ok, id } = parsed as { ok?: unknown; id?: unknown }
    if (ok !== true || typeof id !== 'string') continue
    const batch = out.get(row.at) ?? []
    batch.push({ id, at: row.at })
    out.set(row.at, batch)
  }
  return out
}

class Places {
  private readonly byId = new Map<string, Item>()
  private readonly children = new Map<string | null, Item[]>()

  constructor(items: readonly Item[]) {
    for (const item of items) {
      this.byId.set(item.id, item)
      const list = this.children.get(item.parent) ?? []
      list.push(item)
      this.children.set(item.parent, list)
    }
  }

  get(id: string): Item | undefined {
    return this.byId.get(id)
  }

  inside(parent: string | null): Item[] {
    return this.children.get(parent) ?? []
  }

  twin(of: Item, name: string): Item | undefined {
    const key = nameKey(name)
    return this.inside(of.parent).find(
      (one) =>
        one.id !== of.id &&
        one.folder === of.folder &&
        (of.folder || one.kind === of.kind) &&
        one.seq < of.seq &&
        nameKey(one.name) === key,
    )
  }

  pathOf(id: string): string {
    const names: string[] = []
    for (let at = this.byId.get(id); at; at = at.parent ? this.byId.get(at.parent) : undefined) {
      names.unshift(at.name)
    }
    return names.join('/')
  }
}

function copiesIn(
  places: Places,
  batches: ReadonlyMap<number, readonly Made[]>,
): { keep: Item; drop: Item; at: number }[] {
  const out: { keep: Item; drop: Item; at: number }[] = []
  const taken = new Set<string>()
  for (const batch of batches.values()) {
    const found: { keep: Item; drop: Item; at: number }[] = []
    for (const made of batch) {
      const drop = places.get(made.id)
      if (!drop || taken.has(drop.id)) continue
      const wanted = nameFrom(drop.name)
      if (nameKey(wanted) === nameKey(drop.name)) continue
      const keep = places.twin(drop, wanted)
      if (keep && !taken.has(keep.id)) found.push({ keep, drop, at: made.at })
    }
    if (found.length < SAME_BATCH) continue
    for (const one of found) {
      taken.add(one.drop.id)
      out.push(one)
    }
  }
  return out.sort((a, b) => a.drop.seq - b.drop.seq)
}

async function bodyOf(env: Env, spaceId: string, id: string): Promise<string> {
  const object = await env.NOTES.get(noteKey(spaceId, id))
  return object ? await object.text() : ''
}

async function noteRow(env: Env, id: string): Promise<Note | null> {
  return await env.DB.prepare('select * from notes where id = ?').bind(id).first<Note>()
}

class Mender {
  readonly ops: Op[] = []
  readonly done: Mending = { pairs: [], moved: [], versions: 0, protected: 0 }
  readonly guarded: { from: string; to: string }[] = []

  constructor(
    private readonly env: Env,
    private readonly spaceId: string,
    private readonly places: Places,
    private readonly seen: number,
  ) {}

  private op(fields: Record<string, unknown>): void {
    this.ops.push({ op: `${MENDER}.${newId()}`, seen: this.seen, ...fields } as Op)
  }

  async pair(keep: Item, drop: Item, at: number): Promise<void> {
    const merged = keep.folder
      ? await this.folders(keep, drop, at)
      : await this.notes(keep, drop, at)
    if (!merged) return
    this.described(keep, drop)
    this.guarded.push({ from: this.places.pathOf(drop.id), to: this.places.pathOf(keep.id) })
    this.op({ t: 'delete', id: drop.id })
    this.done.pairs.push({ keep: keep.id, drop: drop.id })
  }

  private async folders(keep: Item, drop: Item, at: number): Promise<boolean> {
    for (const child of this.places.inside(drop.id)) {
      const twin = this.places
        .inside(keep.id)
        .find(
          (one) =>
            one.folder === child.folder &&
            (child.folder || one.kind === child.kind) &&
            nameKey(one.name) === nameKey(child.name),
        )
      if (twin) {
        await this.pair(twin, child, at)
        if (this.done.pairs.some((one) => one.drop === child.id)) continue
      }
      this.op({ t: 'move', id: child.id, parent: keep.id })
      this.done.moved.push(child.id)
    }
    return true
  }

  private async notes(keep: Item, drop: Item, at: number): Promise<boolean> {
    if (drop.hash === keep.hash) return true
    if (!DOCUMENT_KINDS.has(drop.kind)) return false
    const dropped = await bodyOf(this.env, this.spaceId, drop.id)
    if (!dropped) return true
    const kept = await bodyOf(this.env, this.spaceId, keep.id)
    if (dropped === kept) return true
    const edited =
      !kept || (drop.updated_at > at + EDITED_AFTER && drop.updated_at > keep.updated_at)
    if (!edited) {
      await this.kept(keep.id, dropped)
      return true
    }
    const target = await noteRow(this.env, keep.id)
    if (!target) return false
    if (kept) await this.kept(keep.id, kept)
    return (await ingestInto(this.env, target, dropped, { name: 'Orden', device: MENDER })) !== null
  }

  private async kept(id: string, text: string): Promise<void> {
    const held = await this.env.DB.prepare(
      'select 1 as one from note_versions where note_id = ? and hash = ? limit 1',
    )
      .bind(id, await sha256(text))
      .first<{ one: number }>()
    if (held) return
    await keepVersionNow(this.env, id, text, MENDER)
    this.done.versions += 1
  }

  private described(keep: Item, drop: Item): void {
    const theirs = metaFromText(drop.meta) ?? {}
    const ours = metaFromText(keep.meta) ?? {}
    const patch: Record<string, string> = {}
    for (const [key, value] of Object.entries(theirs)) if (!(key in ours)) patch[key] = value
    if (Object.keys(patch).length) this.op({ t: 'meta', id: keep.id, meta: patch })
  }
}

async function mendSpace(env: Env, space: Reached, later: Later): Promise<Mending | null> {
  const items = await liveItems(env, space.id)
  const places = new Places(items)
  const copies = copiesIn(places, await madeInBatches(env, space.id))
  if (!copies.length) return null

  const cursor = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(space.id)
    .first<{ next: number }>()
  const mender = new Mender(env, space.id, places, Math.max(0, (cursor?.next ?? 1) - 1))

  const backup = `mended/${space.id}/${String(now())}`
  await env.NOTES.put(
    `${backup}.json`,
    JSON.stringify({
      at: now(),
      pairs: copies.map(({ keep, drop, at }) => ({ keep, drop, at })),
      inside: copies
        .filter(({ drop }) => drop.folder)
        .map(({ drop }) => ({
          folder: drop.id,
          items: items.filter((one) => one.parent === drop.id),
        })),
    }),
  )

  for (const { keep, drop, at } of copies) await mender.pair(keep, drop, at)
  if (!mender.ops.length) {
    await env.NOTES.put(`${backup}.done.json`, JSON.stringify(mender.done))
    return mender.done
  }

  const owner = { ...space, role: 'owner' as const }
  const done = await applyOps(env, owner, space.user_id, MENDER, mender.ops)
  if (done.changed) {
    await reproject(env, space.id, done.tree)
    await pokeSpace(env, later, space.id, done.cursor, MENDER)
  }
  mender.done.protected = await protectLikewise(env, space.user_id, space.id, mender.guarded)
  await env.NOTES.put(`${backup}.done.json`, JSON.stringify(mender.done))
  return mender.done
}

export async function mendedSpace(env: Env, space: Reached, later: Later): Promise<void> {
  if (space.mended_at) return
  const claimed = await env.DB.prepare(
    'update spaces set mended_at = ? where id = ? and mended_at is null',
  )
    .bind(now(), space.id)
    .run()
  if (!claimed.meta.changes) return
  try {
    const done = await mendSpace(env, space, later)
    if (done) {
      console.warn(
        `mend ${space.id}: ${String(done.pairs.length)} pairs merged, ${String(done.moved.length)} moved, ${String(done.versions)} kept as versions, ${String(done.protected)} protected`,
      )
    }
  } catch (error) {
    await env.DB.prepare('update spaces set mended_at = null where id = ?').bind(space.id).run()
    console.error(`mend ${space.id}: ${String(error)}`)
  }
}
