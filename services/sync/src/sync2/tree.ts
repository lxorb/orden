import { freePath, uncounted } from '@orden/markdown/paths'
import {
  applyOp,
  heldName,
  LONGEST_NAME,
  contentChanged,
  type EntryKind,
  kindOfName,
  nameKey,
  type Op,
  type OpContext,
  type OpResult,
  type TreeEntry,
  type TreeState,
  treeState,
} from '@orden/sync-core'
import { LIST_KEY } from '@orden/bases/todo-lists'
import { metaFromText, metaText } from '@orden/sync-core/meta'
import { chunks } from '../bound'
import { type Moved, rememberMoves } from '../blog/paths'
import { picturesOfMeta } from '../pictures'
import { newId, now } from '../crypto'
import type { Env } from '../types'

export const DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  'note',
  'canvas',
  'pages',
  'url',
  'term',
  'chat',
])

export const DOCUMENTS_SQL = "('note', 'canvas', 'pages', 'url', 'term', 'chat')"

export { kindOfName }

function kindIn(value: string, name: string): EntryKind {
  if (value === 'folder' || value === 'file' || DOCUMENT_KINDS.has(value)) {
    return value as EntryKind
  }
  return kindOfName(name)
}

export interface Content {
  hash: string
  size: number
  front: string | null
  epoch: number
  epochBase: string | null
}

type Snapshot = Omit<TreeEntry, 'id' | 'kind'>

function snapshotOf(entry: TreeEntry): Snapshot {
  const snapshot: Snapshot = {
    parent: entry.parent,
    name: entry.name,
    deleted: entry.deleted,
    seq: entry.seq,
    docSeq: entry.docSeq,
  }
  if (entry.by !== undefined) snapshot.by = entry.by
  if (entry.docBy !== undefined) snapshot.docBy = entry.docBy
  if (entry.deletedIn !== undefined) snapshot.deletedIn = entry.deletedIn
  if (entry.placedSeq !== undefined) snapshot.placedSeq = entry.placedSeq
  if (entry.placedBy !== undefined) snapshot.placedBy = entry.placedBy
  if (entry.pos !== undefined) snapshot.pos = entry.pos
  if (entry.meta !== undefined) snapshot.meta = entry.meta
  if (entry.changesBy !== undefined) snapshot.changesBy = entry.changesBy
  return snapshot
}

function sameAs(entry: TreeEntry, before: Snapshot): boolean {
  return (
    entry.parent === before.parent &&
    entry.name === before.name &&
    entry.deleted === before.deleted &&
    entry.seq === before.seq &&
    entry.docSeq === before.docSeq &&
    entry.by === before.by &&
    entry.docBy === before.docBy &&
    entry.deletedIn === before.deletedIn &&
    entry.placedSeq === before.placedSeq &&
    entry.placedBy === before.placedBy &&
    entry.pos === before.pos &&
    metaText(entry.meta) === metaText(before.meta) &&
    entry.changesBy === before.changesBy
  )
}

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  deleted: number
  seq: number
  updated_by: string | null
  deleted_in: number | null
  pos: string | null
  meta: string | null
  changes_by: string | null
}

interface NoteRow {
  id: string
  kind: string
  folder_id: string | null
  name: string | null
  deleted: number
  seq: number
  doc_seq: number | null
  updated_by: string | null
  doc_by: string | null
  deleted_in: number | null
  placed_seq: number | null
  placed_by: string | null
  pos: string | null
  meta: string | null
  changes_by: string | null
  path: string
  epoch: number
}

interface Folders {
  live?: TreeEntry
  deleted?: TreeEntry
}

class Placing {
  private readonly folders = new Map<string, Folders>()
  private readonly taken = new Map<string | null, Set<string>>()

  constructor(entries: Iterable<TreeEntry>) {
    for (const entry of entries) this.add(entry)
  }

  add(entry: TreeEntry) {
    const key = nameKey(entry.name)
    if (!entry.deleted) this.namesIn(entry.parent).add(key)
    if (entry.kind !== 'folder') return
    const slot = this.slot(entry.parent, key)
    if (entry.deleted) slot.deleted ??= entry
    else slot.live ??= entry
  }

  folder(parent: string | null, name: string): Folders | undefined {
    return this.folders.get(`${parent ?? ''}\u0000${nameKey(name)}`)
  }

  free(parent: string | null, wanted: string): string {
    const taken = this.namesIn(parent)
    return freePath(wanted, (candidate) => taken.has(nameKey(candidate)))
  }

  private slot(parent: string | null, key: string): Folders {
    const at = `${parent ?? ''}\u0000${key}`
    let slot = this.folders.get(at)
    if (!slot) {
      slot = {}
      this.folders.set(at, slot)
    }
    return slot
  }

  private namesIn(parent: string | null): Set<string> {
    let names = this.taken.get(parent)
    if (!names) {
      names = new Set()
      this.taken.set(parent, names)
    }
    return names
  }
}

export class Tree {
  readonly state: TreeState
  private readonly before = new Map<string, Snapshot>()
  private readonly paths = new Map<string, string>()
  private readonly raw: NoteRow[] = []
  private readonly rawIds = new Set<string>()
  readonly content = new Map<string, Content>()
  private readonly answered = new Map<string, OpResult>()
  private unmarked = false
  moves: Moved[] = []

  constructor(
    readonly spaceId: string,
    readonly next: number,
    folders: readonly FolderRow[],
    notes: readonly NoteRow[],
    private readonly device: string | undefined,
    unmarked?: boolean,
  ) {
    const entries: TreeEntry[] = []
    for (const row of folders) entries.push(folderEntry(row))
    for (const row of notes) {
      if (row.epoch === 0 && DOCUMENT_KINDS.has(kindIn(row.kind, row.name ?? row.path))) {
        this.unmarked = true
      }
      this.paths.set(row.id, row.path)
      if (row.name === null) {
        this.raw.push(row)
        this.rawIds.add(row.id)
        continue
      }
      entries.push(noteEntry(row, row.name))
    }

    if (unmarked !== undefined) this.unmarked = unmarked
    this.state = treeState(entries, next - 1)
    for (const entry of this.state.entries.values()) this.before.set(entry.id, snapshotOf(entry))
    this.heal()
  }

  get healed(): boolean {
    return this.raw.length > 0
  }

  private heal() {
    if (!this.raw.length) return
    const rows = [...this.raw].sort((a, b) => a.seq - b.seq)
    const placing = new Placing(this.state.entries.values())
    for (const row of rows) {
      const parts = row.path.split('/')
      const name = parts.pop() ?? row.path
      const live = row.deleted === 0

      let parent: string | null = null
      for (const part of parts) parent = this.folderFor(placing, parent, part, live, row.seq)

      const placed = live ? placing.free(parent, name) : name
      const entry = noteEntry(row, placed)
      entry.parent = parent
      entry.kind = kindIn(row.kind === 'note' ? kindOfName(name) : row.kind, name)
      this.state.entries.set(entry.id, entry)
      placing.add(entry)
      this.before.set(entry.id, { ...snapshotOf(entry), name: '' })
    }
  }

  private folderFor(
    placing: Placing,
    parent: string | null,
    name: string,
    live: boolean,
    seq: number,
  ): string {
    const found = placing.folder(parent, name)
    if (found?.live) return found.live.id

    const deleted = found?.deleted
    if (deleted) {
      if (live) {
        deleted.deleted = false
        delete deleted.deletedIn
        deleted.seq = this.tick()
        placing.add(deleted)
      }
      return deleted.id
    }

    const folder: TreeEntry = {
      id: newId(),
      kind: 'folder',
      parent,
      name: live ? placing.free(parent, name) : name,
      deleted: !live,
      seq: this.tick(),
      docSeq: 0,
    }
    if (!live) folder.deletedIn = seq
    this.state.entries.set(folder.id, folder)
    placing.add(folder)
    return folder.id
  }

  private tick(): number {
    this.state.cursor += 1
    return this.state.cursor
  }

  apply(op: Op, context: OpContext): OpResult {
    const repeated = this.state.done.has(op.op)
    const result = applyOp(this.state, op, context)
    if (!repeated) this.answered.set(op.op, result)
    return result
  }

  answers(op: string): boolean {
    return this.state.done.has(op)
  }

  remember(done: ReadonlyMap<string, OpResult>) {
    for (const [op, result] of done) this.state.done.set(op, result)
  }

  touch(id: string, device?: string): number {
    return contentChanged(this.state, id, device)
  }

  entry(id: string): TreeEntry | undefined {
    return this.state.entries.get(id)
  }

  child(parent: string | null, name: string): TreeEntry | undefined {
    const key = nameKey(name)
    for (const entry of this.state.entries.values()) {
      if (!entry.deleted && entry.parent === parent && nameKey(entry.name) === key) return entry
    }
    return undefined
  }

  lookup(): (parent: string | null, name: string) => TreeEntry | undefined {
    const live = new Map<string, TreeEntry>()
    for (const entry of this.state.entries.values()) {
      const at = `${entry.parent ?? ''}\u0000${nameKey(entry.name)}`
      if (!entry.deleted && !live.has(at)) live.set(at, entry)
    }
    return (parent, name) => live.get(`${parent ?? ''}\u0000${nameKey(name)}`)
  }

  pathOf(id: string): string {
    const names: string[] = []
    const seen = new Set<string>()
    for (let at: string | null = id; at !== null && !seen.has(at);) {
      seen.add(at)
      const entry = this.state.entries.get(at)
      if (!entry) break
      names.push(entry.name)
      at = entry.parent
    }
    return names.reverse().join('/')
  }

  private moved(): Map<string, string> {
    const out = new Map<string, string>()
    const moving: TreeEntry[] = []
    for (const entry of this.state.entries.values()) {
      if (entry.kind === 'folder') continue
      const path = this.pathOf(entry.id)
      if (path === this.paths.get(entry.id)) continue
      out.set(entry.id, path)
      moving.push(entry)
    }
    for (const entry of moving) {
      const before = this.before.get(entry.id)
      if (this.rawIds.has(entry.id) || (before && sameAs(entry, before))) {
        entry.seq = this.tick()
        if (this.device === undefined) delete entry.by
        else entry.by = this.device
      }
    }
    return out
  }

  placed(): Set<string> {
    const out = new Set<string>()
    for (const entry of this.state.entries.values()) {
      const before = this.before.get(entry.id)
      if (
        before?.parent !== entry.parent ||
        before.name !== entry.name ||
        before.deleted !== entry.deleted
      ) {
        out.add(entry.id)
      }
    }
    return out
  }

  relisted(): string[] {
    const out: string[] = []
    for (const entry of this.state.entries.values()) {
      const before = this.before.get(entry.id)
      if (entry.kind === 'folder' || entry.deleted || !before) continue
      if (entry.meta?.[LIST_KEY] !== before.meta?.[LIST_KEY]) out.push(entry.id)
    }
    return out
  }

  statements(env: Env): D1PreparedStatement[] | null {
    const moved = this.moved()
    const at = now()
    this.moves = [...moved].flatMap(([id, to]) => {
      const from = this.paths.get(id)
      const entry = this.state.entries.get(id)
      return from === undefined || !entry || entry.deleted ? [] : [{ id, from, to }]
    })

    const folders: Record<string, unknown>[] = []
    const newFolders: Record<string, unknown>[] = []
    const notes: Record<string, unknown>[] = []
    const newNotes: Record<string, unknown>[] = []

    for (const entry of this.state.entries.values()) {
      const before = this.before.get(entry.id)
      if (before && sameAs(entry, before) && !moved.has(entry.id)) continue

      const gone = before && before.deleted !== entry.deleted ? (entry.deleted ? 1 : 0) : 2
      const row = {
        id: entry.id,
        parent: entry.parent,
        name: entry.name,
        key: nameKey(entry.name),
        seq: entry.seq,
        deleted: entry.deleted ? 1 : 0,
        gone,
        deletedIn: entry.deletedIn ?? null,
        by: entry.by ?? null,
        pos: entry.pos ?? null,
        meta: metaText(entry.meta),
        changesBy: entry.changesBy ? JSON.stringify(entry.changesBy) : null,
      }

      if (entry.kind === 'folder') {
        ;(before ? folders : newFolders).push(row)
        continue
      }

      const path = moved.get(entry.id) ?? this.paths.get(entry.id) ?? this.pathOf(entry.id)
      const placed = {
        ...row,
        kind: entry.kind,
        path,
        docSeq: entry.docSeq,
        docBy: entry.docBy ?? null,
        placedSeq: entry.placedSeq ?? null,
        placedBy: entry.placedBy ?? null,
        bump: moved.has(entry.id) || gone !== 2 ? 1 : 0,
      }
      if (before) {
        notes.push(placed)
        continue
      }

      const content = this.content.get(entry.id) ?? emptyContent(entry.kind)
      newNotes.push({
        ...placed,
        hash: content.hash,
        size: content.size,
        front: content.front,
        epoch: content.epoch,
        epochBase: content.epochBase,
      })
    }

    const described = [...this.state.entries.values()].flatMap((entry) => {
      if (entry.kind === 'folder') return []
      const before = this.before.get(entry.id)
      if (metaText(entry.meta) === metaText(before?.meta)) return []
      return picturesOfMeta(entry.meta).map((hash) => ({ id: entry.id, hash }))
    })

    const ops = [...this.answered].map(([op, result]) => ({
      id: `${this.spaceId}/${op}`,
      result: JSON.stringify(result),
    }))

    const changed = folders.length + newFolders.length + notes.length + newNotes.length > 0
    if (!changed && !ops.length && !this.unmarked) return null

    const db = env.DB
    const space = this.spaceId
    const out: D1PreparedStatement[] = []

    if (changed) {
      out.push(guard(db, space, this.next))

      for (const piece of chunks(
        folders.map((one) => one.id),
        500,
      )) {
        out.push(
          db
            .prepare(
              `update folders set name_key = char(0) || id
                where id in (select value from json_each(?2)) and +space_id = ?1`,
            )
            .bind(space, JSON.stringify(piece)),
        )
      }
      for (const piece of chunks(
        notes.map((one) => one.id),
        500,
      )) {
        out.push(
          db
            .prepare(
              `update notes set name_key = char(0) || id, path = char(0) || id
                where id in (select value from json_each(?2)) and +space_id = ?1`,
            )
            .bind(space, JSON.stringify(piece)),
        )
      }

      for (const piece of chunks(folders, 500)) out.push(updateFolders(db, space, at, piece))
      for (const piece of chunks(newFolders, 500)) out.push(insertFolders(db, space, at, piece))
      for (const piece of chunks(notes, 500)) out.push(updateNotes(db, space, at, piece))
      for (const piece of chunks(newNotes, 500)) out.push(insertNotes(db, space, at, piece))

      out.push(
        db
          .prepare(
            `insert into space_cursor (space_id, next) values (?1, ?2)
             on conflict(space_id) do update set next = excluded.next`,
          )
          .bind(space, this.state.cursor + 1),
      )
    }

    if (this.unmarked) out.push(markEpochs(db, space))

    for (const piece of chunks(described, 500)) {
      out.push(
        db
          .prepare(
            `insert or ignore into note_pictures (note_id, hash)
             select json_extract(value, '$.id'), json_extract(value, '$.hash') from json_each(?1)`,
          )
          .bind(JSON.stringify(piece)),
      )
    }

    for (const piece of chunks(ops, 200)) {
      out.push(
        db
          .prepare(
            `insert or ignore into tree_ops (op_id, space_id, result, at)
             select json_extract(value, '$.id'), ?1, json_extract(value, '$.result'), ?2
               from json_each(?3)`,
          )
          .bind(space, at, JSON.stringify(piece)),
      )
    }

    return out
  }
}

function markEpochs(db: D1Database, space: string): D1PreparedStatement {
  return db
    .prepare(
      `update notes set epoch = 1, epoch_base = hash
        where space_id = ?1 and epoch = 0 and kind in ${DOCUMENTS_SQL}`,
    )
    .bind(space)
}

function emptyContent(kind: EntryKind): Content {
  const document = DOCUMENT_KINDS.has(kind)
  return {
    hash: EMPTY_HASH,
    size: 0,
    front: null,
    epoch: document ? 1 : 0,
    epochBase: document ? EMPTY_HASH : null,
  }
}

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function guard(db: D1Database, space: string, next: number): D1PreparedStatement {
  return db
    .prepare(
      `insert into space_cursor (space_id, next)
       select ?1, 0 where coalesce((select next from space_cursor where space_id = ?1), 1) != ?2`,
    )
    .bind(space, next)
}

function field(name: string): string {
  return `json_extract(value, '$.${name}')`
}

function updateFolders(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `update folders set parent_id = c.parent, name = c.name, name_key = c.key, seq = c.seq,
              deleted = c.deleted,
              deleted_at = case c.gone when 1 then ?2 when 0 then null else folders.deleted_at end,
              deleted_in = c.deleted_in, updated_at = ?2, updated_by = c.by, pos = c.pos,
              meta = c.meta, changes_by = c.changes_by
         from (select ${field('id')} as fid, ${field('parent')} as parent, ${field('name')} as name,
                      ${field('key')} as key, ${field('seq')} as seq, ${field('deleted')} as deleted,
                      ${field('gone')} as gone, ${field('deletedIn')} as deleted_in,
                      ${field('by')} as by, ${field('pos')} as pos, ${field('meta')} as meta,
                      ${field('changesBy')} as changes_by
                 from json_each(?3)) as c
        where folders.id = c.fid and +folders.space_id = ?1`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function insertFolders(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `insert into folders (id, space_id, parent_id, name, name_key, seq, deleted, deleted_at,
                            deleted_in, updated_at, updated_by, pos, meta, changes_by)
       select ${field('id')}, ?1, ${field('parent')}, ${field('name')}, ${field('key')},
              ${field('seq')}, ${field('deleted')},
              case ${field('deleted')} when 1 then ?2 else null end,
              ${field('deletedIn')}, ?2, ${field('by')}, ${field('pos')}, ${field('meta')},
              ${field('changesBy')}
         from json_each(?3)`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function updateNotes(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `update notes set folder_id = c.parent, name = c.name, name_key = c.key, kind = c.kind,
              path = c.path, seq = c.seq, deleted = c.deleted,
              deleted_at = case c.gone when 1 then ?2 when 0 then null else notes.deleted_at end,
              deleted_in = c.deleted_in, updated_by = c.by, doc_seq = c.doc_seq,
              doc_by = c.doc_by, placed_seq = c.placed_seq, placed_by = c.placed_by, pos = c.pos,
              meta = c.meta, changes_by = c.changes_by, version = notes.version + c.bump,
              updated_at = case c.bump when 1 then ?2 else notes.updated_at end
         from (select ${field('id')} as nid, ${field('parent')} as parent, ${field('name')} as name,
                      ${field('key')} as key, ${field('kind')} as kind, ${field('path')} as path,
                      ${field('seq')} as seq, ${field('deleted')} as deleted,
                      ${field('gone')} as gone, ${field('deletedIn')} as deleted_in,
                      ${field('by')} as by, ${field('docSeq')} as doc_seq,
                      ${field('docBy')} as doc_by, ${field('placedSeq')} as placed_seq,
                      ${field('placedBy')} as placed_by, ${field('pos')} as pos,
                      ${field('meta')} as meta, ${field('changesBy')} as changes_by,
                      ${field('bump')} as bump
                 from json_each(?3)) as c
        where notes.id = c.nid and +notes.space_id = ?1`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function insertNotes(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, deleted_at, size,
                          hash, front, folder_id, name, name_key, kind, epoch, epoch_base,
                          doc_seq, doc_by, updated_by, deleted_in, placed_seq, placed_by, pos,
                          meta, changes_by)
       select ${field('id')}, ?1, ${field('path')}, ${field('seq')}, 1, ?2, ${field('deleted')},
              case ${field('deleted')} when 1 then ?2 else null end, ${field('size')},
              ${field('hash')}, ${field('front')}, ${field('parent')}, ${field('name')},
              ${field('key')}, ${field('kind')}, ${field('epoch')}, ${field('epochBase')},
              ${field('docSeq')}, ${field('docBy')}, ${field('by')}, ${field('deletedIn')},
              ${field('placedSeq')}, ${field('placedBy')}, ${field('pos')}, ${field('meta')},
              ${field('changesBy')}
         from json_each(?3)`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function folderEntry(row: FolderRow): TreeEntry {
  const entry: TreeEntry = {
    id: row.id,
    kind: 'folder',
    parent: row.parent_id,
    name: row.name,
    deleted: row.deleted === 1,
    seq: row.seq,
    docSeq: 0,
  }
  if (row.updated_by !== null) entry.by = row.updated_by
  if (row.deleted_in !== null) entry.deletedIn = row.deleted_in
  if (row.pos !== null) entry.pos = row.pos
  const meta = metaFromText(row.meta)
  if (meta) entry.meta = meta
  const changes = changesIn(row.changes_by)
  if (changes) entry.changesBy = changes
  return entry
}

function changesIn(value: string | null): Record<string, number> | undefined {
  if (value === null) return undefined
  let read: unknown
  try {
    read = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof read !== 'object' || read === null || Array.isArray(read)) return undefined
  const out: Record<string, number> = {}
  for (const [device, at] of Object.entries(read)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[device] = at
  }
  return Object.keys(out).length ? out : undefined
}

function noteEntry(row: NoteRow, name: string): TreeEntry {
  const entry: TreeEntry = {
    id: row.id,
    kind: kindIn(row.kind, name),
    parent: row.folder_id,
    name,
    deleted: row.deleted === 1,
    seq: row.seq,
    docSeq: row.doc_seq ?? row.seq,
  }
  if (row.updated_by !== null) entry.by = row.updated_by
  if (row.doc_by !== null) entry.docBy = row.doc_by
  if (row.deleted_in !== null) entry.deletedIn = row.deleted_in
  if (row.placed_seq !== null) entry.placedSeq = row.placed_seq
  if (row.placed_by !== null) entry.placedBy = row.placed_by
  if (row.pos !== null) entry.pos = row.pos
  const meta = metaFromText(row.meta)
  if (meta) entry.meta = meta
  const changes = changesIn(row.changes_by)
  if (changes) entry.changesBy = changes
  return entry
}

const FOLDER_COLUMNS =
  'id, parent_id, name, deleted, seq, updated_by, deleted_in, pos, meta, changes_by'

const NOTE_COLUMNS = `id, kind, folder_id, name, deleted, seq, doc_seq, updated_by, doc_by, deleted_in,
            placed_seq, placed_by, pos, meta, changes_by, path, epoch`

const KEPT = 'not (deleted = 1 and deleted_at is null)'

async function cursorOf(env: Env, spaceId: string): Promise<number> {
  const cursor = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(spaceId)
    .first<{ next: number }>()
  return cursor?.next ?? 1
}

export async function readTree(env: Env, spaceId: string, device?: string): Promise<Tree> {
  const next = await cursorOf(env, spaceId)
  const folders = await env.DB.prepare(
    `select ${FOLDER_COLUMNS} from folders where space_id = ? order by id`,
  )
    .bind(spaceId)
    .all<FolderRow>()
  const notes = await env.DB.prepare(
    `select ${NOTE_COLUMNS} from notes where space_id = ? and ${KEPT} order by id`,
  )
    .bind(spaceId)
    .all<NoteRow>()

  return new Tree(spaceId, next, folders.results, notes.results, device)
}

interface Touched {
  id: string
  parent?: string | null
  name?: string
}

interface Walk {
  id?: string
  folders: readonly string[]
  name: string
}

export interface Reach {
  ids: readonly string[]
  touched: readonly Touched[]
  under: readonly string[]
  walks?: readonly Walk[]
}

export function reachOf(ops: readonly Op[]): Reach {
  const ids: string[] = []
  const touched: Touched[] = []
  const under: string[] = []
  for (const op of ops) {
    ids.push(op.id)
    if (op.t === 'create' || op.t === 'mkdir') {
      if (op.parent !== null) ids.push(op.parent)
      touched.push({ id: op.id, parent: op.parent, name: op.name })
    } else if (op.t === 'move') {
      if (op.parent !== null) ids.push(op.parent)
      touched.push(
        op.name === undefined
          ? { id: op.id, parent: op.parent }
          : { id: op.id, parent: op.parent, name: op.name },
      )
    } else if (op.t === 'rename') {
      touched.push({ id: op.id, name: op.name })
    } else {
      touched.push({ id: op.id })
    }
    if (op.t === 'move' || op.t === 'rename' || op.t === 'delete' || op.t === 'restore') {
      under.push(op.id)
    }
  }
  return { ids, touched, under }
}

class Rows {
  readonly folders = new Map<string, FolderRow>()
  readonly notes = new Map<string, NoteRow>()

  constructor(
    private readonly env: Env,
    private readonly spaceId: string,
  ) {}

  async byIds(ids: readonly string[]) {
    const wanted = [...new Set(ids)].filter((id) => !this.has(id))
    for (const piece of chunks(wanted, 500)) {
      const list = JSON.stringify(piece)
      await this.folderRows(`id in (select value from json_each(?2))`, list)
      await this.noteRows(`id in (select value from json_each(?2))`, list)
    }
  }

  async above() {
    const starts = new Set<string>()
    for (const row of this.folders.values()) if (row.parent_id !== null) starts.add(row.parent_id)
    for (const row of this.notes.values()) if (row.folder_id !== null) starts.add(row.folder_id)
    const wanted = [...starts].filter((id) => !this.folders.has(id))
    for (const piece of chunks(wanted, 500)) {
      await this.folderRows(
        `id in (with recursive up(id) as (
                  select value from json_each(?2)
                  union select f.parent_id from folders f join up on f.id = up.id
                   where f.space_id = ?1 and f.parent_id is not null)
                select id from up)`,
        JSON.stringify(piece),
      )
    }
  }

  async below(ids: readonly string[]) {
    const roots = [...new Set(ids)].filter((id) => this.folders.has(id))
    for (const piece of chunks(roots, 100)) {
      const inside = `(with recursive down(id) as (
                         select value from json_each(?2)
                         union select f.id from folders f join down on f.parent_id = down.id
                          where f.space_id = ?1)
                       select id from down)`
      const list = JSON.stringify(piece)
      await this.folderRows(`id in ${inside}`, list)
      await this.noteRows(`folder_id in ${inside}`, list)
    }
  }

  async named(parent: string | null, name: string) {
    const prefix = keyPrefix(name)
    const where = (column: string) =>
      `coalesce(${column}, '') = ?2 and deleted = 0 and substr(name_key, 1, length(?3)) = ?3`
    await this.folderRows(where('parent_id'), parent ?? '', prefix)
    await this.noteRows(where('folder_id'), parent ?? '', prefix)
  }

  foldersNamed(parent: string | null, name: string): string[] {
    const key = nameKey(name)
    return [...this.folders.values()]
      .filter(
        (row) =>
          (row.parent_id ?? '') === (parent ?? '') &&
          row.deleted === 0 &&
          nameKey(row.name) === key,
      )
      .map((row) => row.id)
  }

  parentOf(id: string): string | null | undefined {
    const folder = this.folders.get(id)
    if (folder) return folder.parent_id
    const note = this.notes.get(id)
    return note ? note.folder_id : undefined
  }

  nameOf(id: string): string | null | undefined {
    return this.folders.get(id)?.name ?? this.notes.get(id)?.name
  }

  private has(id: string): boolean {
    return this.folders.has(id) || this.notes.has(id)
  }

  private async folderRows(where: string, ...values: unknown[]) {
    const { results } = await this.env.DB.prepare(
      `select ${FOLDER_COLUMNS} from folders where space_id = ?1 and ${where}`,
    )
      .bind(this.spaceId, ...values)
      .all<FolderRow>()
    for (const row of results) this.folders.set(row.id, row)
  }

  private async noteRows(where: string, ...values: unknown[]) {
    const { results } = await this.env.DB.prepare(
      `select ${NOTE_COLUMNS} from notes where space_id = ?1 and ${KEPT} and ${where}`,
    )
      .bind(this.spaceId, ...values)
      .all<NoteRow>()
    for (const row of results) this.notes.set(row.id, row)
  }
}

const NUMBERED = 16

function keyPrefix(given: string): string {
  const name = heldName(given)
  if (name.length > LONGEST_NAME - NUMBERED) return ''
  const dot = name.lastIndexOf('.')
  const key = nameKey(uncounted(dot > 0 ? name.slice(0, dot) : name))
  return /[σς]$/u.test(key) ? key.slice(0, -1) : key
}

async function unhealed(env: Env, spaceId: string): Promise<{ raw: boolean; unmarked: boolean }> {
  const row = await env.DB.prepare(
    `select exists(select 1 from notes where space_id = ?1 and name is null and ${KEPT}) as raw,
            exists(select 1 from notes where space_id = ?1 and epoch = 0
                     and kind in ${DOCUMENTS_SQL} and ${KEPT}) as unmarked`,
  )
    .bind(spaceId)
    .first<{ raw: number; unmarked: number }>()
  return { raw: row?.raw === 1, unmarked: row?.unmarked === 1 }
}

export async function readReach(
  env: Env,
  spaceId: string,
  device: string | undefined,
  reach: Reach,
): Promise<Tree> {
  const next = await cursorOf(env, spaceId)
  const { raw, unmarked } = await unhealed(env, spaceId)
  if (raw) return await readTree(env, spaceId, device)

  const rows = new Rows(env, spaceId)
  await rows.byIds(reach.ids)
  await rows.above()
  const revived = [...rows.folders.values()].filter((row) => row.deleted === 1)
  await rows.below([...reach.under, ...revived.map((row) => row.id)])
  await rows.above()

  const named = new Map<string, { parent: string | null; name: string }>()
  const name = (parent: string | null, wanted: string) => {
    if (wanted) named.set(`${parent ?? ''}\u0000${wanted}`, { parent, name: wanted })
  }
  const parents = new Map<string, Set<string | null>>()
  const names = new Map<string, Set<string>>()
  const add = <T>(into: Map<string, Set<T>>, id: string, value: T) => {
    const held = into.get(id) ?? new Set<T>()
    held.add(value)
    into.set(id, held)
  }
  for (const walk of reach.walks ?? []) {
    let at: (string | null)[] = [null]
    for (const folder of walk.folders) {
      const next: string[] = []
      for (const parent of at) {
        await rows.named(parent, folder)
        next.push(...rows.foldersNamed(parent, folder))
      }
      at = next
      if (!at.length) break
    }
    for (const parent of at) {
      if (walk.id === undefined) await rows.named(parent, walk.name)
      else add(parents, walk.id, parent)
    }
    if (walk.id !== undefined) add(names, walk.id, walk.name)
  }
  for (const one of reach.touched) {
    const parent = rows.parentOf(one.id)
    const own = rows.nameOf(one.id)
    if (parent !== undefined) add(parents, one.id, parent)
    if (own) add(names, one.id, own)
    if (one.parent !== undefined) add(parents, one.id, one.parent)
    if (one.name !== undefined) add(names, one.id, one.name)
  }
  for (const [id, places] of parents) {
    for (const parent of places) for (const wanted of names.get(id) ?? []) name(parent, wanted)
  }
  for (const row of rows.folders.values()) if (row.deleted === 1) name(row.parent_id, row.name)
  for (const one of named.values()) await rows.named(one.parent, one.name)

  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const folders = [...rows.folders.values()].sort(byId)
  const notes = [...rows.notes.values()].sort(byId)
  return new Tree(spaceId, next, folders, notes, device, unmarked)
}

export interface Changed<T> {
  value: T
  cursor: number
  changed: boolean
  relisted: string[]
  tree: Tree
}

const ATTEMPTS = 6

export async function changeTree<T>(
  env: Env,
  spaceId: string,
  device: string | undefined,
  work: (tree: Tree) => T | Promise<T>,
  opIds: readonly string[] = [],
  reach?: Reach,
): Promise<Changed<T>> {
  for (let attempt = 0; ; attempt++) {
    const tree = reach
      ? await readReach(env, spaceId, device, reach)
      : await readTree(env, spaceId, device)
    if (opIds.length) tree.remember(await answeredBefore(env, spaceId, opIds))
    const value = await work(tree)
    const batch = tree.statements(env)
    if (!batch) return { value, cursor: tree.state.cursor, changed: false, relisted: [], tree }

    try {
      await env.DB.batch(batch)
      await rememberMoves(env, spaceId, tree.moves).catch(() => undefined)
      return {
        value,
        cursor: tree.state.cursor,
        changed: tree.state.cursor >= tree.next,
        relisted: tree.relisted(),
        tree,
      }
    } catch (error) {
      if (attempt + 1 >= ATTEMPTS || !(await cursorMoved(env, spaceId, tree.next))) throw error
    }
  }
}

async function cursorMoved(env: Env, spaceId: string, next: number): Promise<boolean> {
  const row = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(spaceId)
    .first<{ next: number }>()
  return (row?.next ?? 1) !== next
}

const OPS_KEPT_FOR = 30 * 24 * 60 * 60 * 1000

async function answeredBefore(
  env: Env,
  spaceId: string,
  opIds: readonly string[],
): Promise<Map<string, OpResult>> {
  const prefix = `${spaceId}/`
  const { results } = await env.DB.prepare(
    'select op_id, result from tree_ops where op_id in (select value from json_each(?))',
  )
    .bind(JSON.stringify(opIds.map((op) => prefix + op)))
    .all<{ op_id: string; result: string }>()

  const out = new Map<string, OpResult>()
  for (const row of results) {
    if (!row.op_id.startsWith(prefix)) continue
    try {
      out.set(row.op_id.slice(prefix.length), JSON.parse(row.result) as OpResult)
    } catch {
      // A row that does not parse answers nothing, and the op is applied as new.
    }
  }
  return out
}

export async function sweepTreeOps(env: Env, at: number): Promise<void> {
  await env.DB.prepare('delete from tree_ops where at < ?')
    .bind(at - OPS_KEPT_FOR)
    .run()
}
