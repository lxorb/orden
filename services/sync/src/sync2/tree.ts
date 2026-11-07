import { freePath } from '@orden/markdown/paths'
import {
  applyOp,
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

export class Tree {
  readonly state: TreeState
  private readonly before = new Map<string, Snapshot>()
  private readonly paths = new Map<string, string>()
  private readonly raw: NoteRow[] = []
  private readonly rawIds = new Set<string>()
  readonly content = new Map<string, Content>()
  private readonly answered = new Map<string, OpResult>()
  private unmarked = false

  constructor(
    readonly spaceId: string,
    readonly next: number,
    folders: readonly FolderRow[],
    notes: readonly NoteRow[],
    private readonly device: string | undefined,
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

    this.state = treeState(entries, next - 1)
    for (const entry of this.state.entries.values()) this.before.set(entry.id, snapshotOf(entry))
    this.heal()
  }

  get healed(): boolean {
    return this.raw.length > 0
  }

  private heal() {
    const rows = [...this.raw].sort((a, b) => a.seq - b.seq)
    for (const row of rows) {
      const parts = row.path.split('/')
      const name = parts.pop() ?? row.path
      const live = row.deleted === 0

      let parent: string | null = null
      for (const part of parts) parent = this.folderFor(parent, part, live, row.seq)

      const placed = live ? this.freeName(parent, name) : name
      const entry = noteEntry(row, placed)
      entry.parent = parent
      entry.kind = kindIn(row.kind === 'note' ? kindOfName(name) : row.kind, name)
      this.state.entries.set(entry.id, entry)
      this.before.set(entry.id, { ...snapshotOf(entry), name: '' })
    }
  }

  private folderFor(parent: string | null, name: string, live: boolean, seq: number): string {
    const key = nameKey(name)
    let deleted: TreeEntry | undefined
    for (const entry of this.state.entries.values()) {
      if (entry.kind !== 'folder' || entry.parent !== parent || nameKey(entry.name) !== key)
        continue
      if (!entry.deleted) return entry.id
      deleted ??= entry
    }

    if (deleted) {
      if (live) {
        deleted.deleted = false
        delete deleted.deletedIn
        deleted.seq = this.tick()
      }
      return deleted.id
    }

    const folder: TreeEntry = {
      id: newId(),
      kind: 'folder',
      parent,
      name: live ? this.freeName(parent, name) : name,
      deleted: !live,
      seq: this.tick(),
      docSeq: 0,
    }
    if (!live) folder.deletedIn = seq
    this.state.entries.set(folder.id, folder)
    return folder.id
  }

  private freeName(parent: string | null, wanted: string): string {
    const taken = new Set<string>()
    for (const entry of this.state.entries.values()) {
      if (!entry.deleted && entry.parent === parent) taken.add(nameKey(entry.name))
    }
    return freePath(wanted, (candidate) => taken.has(nameKey(candidate)))
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
    for (const entry of this.state.entries.values()) {
      if (entry.kind === 'folder') continue
      const path = this.pathOf(entry.id)
      if (path === this.paths.get(entry.id)) continue
      out.set(entry.id, path)

      const before = this.before.get(entry.id)
      if (this.rawIds.has(entry.id) || (before && sameAs(entry, before))) {
        entry.seq = this.tick()
        if (this.device === undefined) delete entry.by
        else entry.by = this.device
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
                where space_id = ?1 and id in (select value from json_each(?2))`,
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
                where space_id = ?1 and id in (select value from json_each(?2))`,
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
        where folders.id = c.fid and folders.space_id = ?1`,
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
        where notes.id = c.nid and notes.space_id = ?1`,
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

export async function readTree(env: Env, spaceId: string, device?: string): Promise<Tree> {
  const cursor = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(spaceId)
    .first<{ next: number }>()
  const folders = await env.DB.prepare(
    `select id, parent_id, name, deleted, seq, updated_by, deleted_in, pos, meta, changes_by
       from folders where space_id = ?`,
  )
    .bind(spaceId)
    .all<FolderRow>()
  const notes = await env.DB.prepare(
    `select id, kind, folder_id, name, deleted, seq, doc_seq, updated_by, doc_by, deleted_in,
            placed_seq, placed_by, pos, meta, changes_by, path, epoch
       from notes where space_id = ? and not (deleted = 1 and deleted_at is null)`,
  )
    .bind(spaceId)
    .all<NoteRow>()

  return new Tree(spaceId, cursor?.next ?? 1, folders.results, notes.results, device)
}

export interface Changed<T> {
  value: T
  cursor: number
  changed: boolean
  relisted: string[]
}

const ATTEMPTS = 6

export async function changeTree<T>(
  env: Env,
  spaceId: string,
  device: string | undefined,
  work: (tree: Tree) => T | Promise<T>,
  opIds: readonly string[] = [],
): Promise<Changed<T>> {
  for (let attempt = 0; ; attempt++) {
    const tree = await readTree(env, spaceId, device)
    if (opIds.length) tree.remember(await answeredBefore(env, spaceId, opIds))
    const value = await work(tree)
    const batch = tree.statements(env)
    if (!batch) return { value, cursor: tree.state.cursor, changed: false, relisted: [] }

    try {
      await env.DB.batch(batch)
      return {
        value,
        cursor: tree.state.cursor,
        changed: tree.state.cursor >= tree.next,
        relisted: tree.relisted(),
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
