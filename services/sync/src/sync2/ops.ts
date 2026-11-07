import {
  type CreateOp,
  isEntryId,
  isName,
  type Op,
  type OpContext,
  type OpResult,
} from '@orden/sync-core'
import type { ItemMeta, MetaPatch } from '@orden/sync-core/meta'
import { newId } from '../crypto'
import type { Env } from '../types'
import type { Reached } from '../spaces/space'
import { type Changed, changeTree, type Content, kindOfName, reachOf, type Tree } from './tree'

const SAW_EVERYTHING = Number.MAX_SAFE_INTEGER

export async function blobSizes(
  env: Env,
  space: Pick<Reached, 'id' | 'user_id'>,
  asker: string | null,
  hashes: Iterable<string>,
): Promise<Map<string, number>> {
  const wanted = [...new Set([...hashes].map((hash) => hash.toLowerCase()))]
  if (!wanted.length) return new Map()

  const { results } = await env.DB.prepare(
    `select b.hash, max(b.size) as size from blobs b
      where b.hash in (select value from json_each(?1))
        and (b.user_id = ?2
             or (b.user_id = ?3
                 and (exists (select 1 from notes n where n.space_id = ?4
                                and (n.paper = b.hash or (n.kind = 'file' and n.hash = b.hash)))
                      or exists (select 1 from spaces s, json_each(s.files) f
                                  where s.id = ?4 and json_extract(f.value, '$.hash') = b.hash))))
      group by b.hash`,
  )
    .bind(JSON.stringify(wanted), asker ?? '', space.user_id, space.id)
    .all<{ hash: string; size: number }>()
  return new Map(results.map((row) => [row.hash, row.size]))
}

function createdHashes(ops: readonly Op[]): string[] {
  return ops.flatMap((op) => (op.t === 'create' && op.kind === 'file' && op.hash ? [op.hash] : []))
}

async function takenIds(env: Env, spaceId: string, ops: readonly Op[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const op of ops) if (op.t === 'create' || op.t === 'mkdir') ids.add(op.id)
  if (!ids.size) return ids

  const { results } = await env.DB.prepare(
    `select id from notes
      where id in (select value from json_each(?1))
        and (space_id != ?2 or (deleted = 1 and deleted_at is null))
     union
     select id from folders where id in (select value from json_each(?1)) and space_id != ?2
     union
     select id from retired_notes where id in (select value from json_each(?1))`,
  )
    .bind(JSON.stringify([...ids]), spaceId)
    .all<{ id: string }>()
  return new Set(results.map((row) => row.id))
}

export async function applyOps(
  env: Env,
  space: Reached,
  asker: string | null,
  device: string,
  ops: readonly Op[],
): Promise<Changed<OpResult[]>> {
  const sizes = await blobSizes(env, space, asker, createdHashes(ops))
  const taken = await takenIds(env, space.id, ops)
  const context: OpContext = { role: space.role, device }

  return await changeTree(
    env,
    space.id,
    device,
    (tree) => ops.map((op) => applied(tree, op, context, sizes, taken)),
    ops.map((op) => op.op),
    reachOf(ops),
  )
}

function applied(
  tree: Tree,
  op: Op,
  context: OpContext,
  sizes: ReadonlyMap<string, number>,
  taken: ReadonlySet<string>,
): OpResult {
  const into = op.t === 'move' || op.t === 'create' || op.t === 'mkdir' ? op.parent : null
  if (into !== null && !isEntryId(into) && !tree.answers(op.op)) {
    return { op: op.op, refused: 'gone' }
  }
  if ((op.t === 'create' || op.t === 'mkdir') && taken.has(op.id) && !tree.answers(op.op)) {
    return { op: op.op, refused: 'gone' }
  }

  if (op.t !== 'create' || op.kind !== 'file' || context.role === 'read') {
    return tree.apply(op, context)
  }

  const hash = op.hash?.toLowerCase()
  const size = hash === undefined ? undefined : sizes.get(hash)
  if (hash === undefined || size === undefined) return { op: op.op, refused: 'gone' }

  const result = tree.apply(op, context)
  tree.content.set(op.id, { hash, size, front: null, epoch: 0, epochBase: null })
  return result
}

function foldersFor(tree: Tree, folders: readonly string[], context: OpContext): string | null {
  let parent: string | null = null
  for (const name of folders) {
    const found = tree.child(parent, name)
    if (found?.kind === 'folder') {
      parent = found.id
      continue
    }

    const id = newId()
    const made = tree.apply(
      { op: newId(), t: 'mkdir', id, parent, name, seen: SAW_EVERYTHING },
      context,
    )
    if (!('id' in made)) throw new Error(`a folder could not be made for ${name}`)
    parent = id
  }
  return parent
}

function split(path: string): { folders: string[]; name: string } {
  const folders = path.split('/')
  const name = folders.pop() ?? path
  if (![...folders, name].every(isName)) throw new Error(`not a place for a note: ${path}`)
  return { folders, name }
}

function noteAtPath(tree: Tree, path: string): string | null {
  const { folders, name } = split(path)
  let parent: string | null = null
  for (const folder of folders) {
    const found = tree.child(parent, folder)
    if (found?.kind !== 'folder') return null
    parent = found.id
  }
  const found = tree.child(parent, name)
  return found && found.kind !== 'folder' ? found.id : null
}

export async function createByPath(
  env: Env,
  spaceId: string,
  device: string | undefined,
  path: string,
  content: Content,
  meta?: ItemMeta,
): Promise<{ made: string } | { taken: string }> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) => {
    const taken = noteAtPath(tree, path)
    if (taken) return { taken }

    const { folders, name } = split(path)
    const parent = foldersFor(tree, folders, context)
    const id = newId()
    const create: CreateOp = {
      op: newId(),
      t: 'create',
      id,
      kind: kindOfName(name),
      parent,
      name,
      seen: SAW_EVERYTHING,
    }
    tree.apply(create, context)
    tree.content.set(id, content)

    const entry = tree.entry(id)
    if (entry) {
      entry.docSeq = entry.seq
      if (device === undefined) delete entry.docBy
      else entry.docBy = device
      if (meta) entry.meta = meta
    }
    return { made: id }
  })
  return value
}

export async function moveByPath(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  path: string,
): Promise<string | null> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) => {
    const { folders, name } = split(path)
    const parent = foldersFor(tree, folders, context)
    const result = tree.apply(
      { op: newId(), t: 'move', id, parent, name, seen: SAW_EVERYTHING },
      context,
    )
    return 'id' in result ? tree.pathOf(id) : null
  })
  return value
}

export async function describeById(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  meta: MetaPatch,
): Promise<Changed<OpResult>> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const op: Op = { op: newId(), t: 'meta', id, meta, seen: SAW_EVERYTHING }
  return await changeTree(
    env,
    spaceId,
    device,
    (tree) => tree.apply(op, context),
    [],
    reachOf([op]),
  )
}

export async function deleteById(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  restore = false,
): Promise<OpResult> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const op: Op = { op: newId(), t: restore ? 'restore' : 'delete', id, seen: SAW_EVERYTHING }
  const { value } = await changeTree(
    env,
    spaceId,
    device,
    (tree) => tree.apply(op, context),
    [],
    reachOf([op]),
  )
  return value
}

export async function revive(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  own: 'stays deleted' | 'comes back' = 'comes back',
): Promise<void> {
  await changeTree(
    env,
    spaceId,
    device,
    (tree) => {
      const entry = tree.entry(id)
      if (!entry?.deleted) return
      if (own === 'stays deleted' && device !== undefined && entry.by === device) return
      tree.touch(id, device)
    },
    [],
    { ids: [id], touched: [{ id }], under: [] },
  )
}
