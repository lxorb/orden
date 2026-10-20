/** Tree operations: a device's, applied in the order they arrive, and a v1 app's writes
 *  said as the same operations.
 *
 *  A v2 device sends `mkdir`, `create`, `rename`, `move`, `delete` and `restore` by id
 *  (docs/sync-v2.md sections 5.9 and 7), and each is answered with where the entry
 *  ended up or why it was refused. A v1 app names paths, and in a space whose tree is
 *  rows its path writes become the same operations here - a create with a server id, a
 *  rename or a move, a delete that asks nothing (a v1 delete names no version to judge
 *  an edit against, so it goes to Recently deleted exactly as it always has) - so the
 *  rows, the paths and every v2 device's feed stay one story whichever app wrote. */

import type { CreateOp, Op, OpContext, OpResult } from '@nib/sync-core'
import { newId } from '../crypto'
import type { Env } from '../types'
import type { Reached } from '../spaces/space'
import { type Changed, changeTree, type Content, kindOfName, type Tree } from './tree'

/** A v1 op judges nothing against what its device had seen. */
const SAW_EVERYTHING = Number.MAX_SAFE_INTEGER

/** The size of each blob a batch of file creates names, by hash: a file's entry is
 *  only made for bytes the asker or the space's owner keeps. Not anybody's: an entry
 *  is a way to read its bytes back through the space, and a hash is something that
 *  can be learned without the file - so naming somebody else's would be reading it. */
async function blobSizes(
  env: Env,
  keepers: readonly string[],
  ops: readonly Op[],
): Promise<Map<string, number>> {
  const hashes = new Set<string>()
  for (const op of ops) {
    if (op.t === 'create' && op.kind === 'file' && op.hash) hashes.add(op.hash.toLowerCase())
  }
  if (!hashes.size) return new Map()

  const { results } = await env.DB.prepare(
    `select hash, max(size) as size from blobs
      where hash in (select value from json_each(?1))
        and user_id in (select value from json_each(?2))
      group by hash`,
  )
    .bind(JSON.stringify([...hashes]), JSON.stringify(keepers))
    .all<{ hash: string; size: number }>()
  return new Map(results.map((row) => [row.hash, row.size]))
}

/** The ids a batch of creates and mkdirs names that are not this space's to make: a
 *  note or a folder of another space, live or deleted; a note of this one purged from
 *  Recently deleted, whose row stays as a tombstone; and an id whose row went for good
 *  with its space or its account (0052).
 *
 *  A device chooses the ids of what it makes, and a note's id names more than its row
 *  - its room above all, which holds the whole document and is emptied only after the
 *  row has gone. So an id is made once, by one space, and never again: a create under
 *  one that was ever somebody else's is refused, as a create of something that has
 *  gone is, rather than handed whatever is still kept under it. */
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

/** A device's batch of ops, applied by the rules, answering each. */
export async function applyOps(
  env: Env,
  space: Reached,
  asker: string | null,
  device: string,
  ops: readonly Op[],
): Promise<Changed<OpResult[]>> {
  const keepers = asker ? [asker, space.user_id] : [space.user_id]
  const sizes = await blobSizes(env, keepers, ops)
  const taken = await takenIds(env, space.id, ops)
  const context: OpContext = { role: space.role, device }

  return await changeTree(
    env,
    space.id,
    device,
    (tree) => ops.map((op) => applied(tree, op, context, sizes, taken)),
    ops.map((op) => op.op),
  )
}

function applied(
  tree: Tree,
  op: Op,
  context: OpContext,
  sizes: ReadonlyMap<string, number>,
  taken: ReadonlySet<string>,
): OpResult {
  // Not written down as the op's answer, so that an op this space already answered -
  // sent again by a device that missed the answer - is still answered as it was.
  if ((op.t === 'create' || op.t === 'mkdir') && taken.has(op.id) && !tree.answers(op.op)) {
    return { op: op.op, refused: 'gone' }
  }

  if (op.t !== 'create' || op.kind !== 'file' || context.role === 'read') {
    return tree.apply(op, context)
  }

  // A file is its bytes, so an entry for bytes nobody uploaded is not made. Not written
  // down as the op's answer either: the device uploads and sends the same op again.
  const hash = op.hash?.toLowerCase()
  const size = hash === undefined ? undefined : sizes.get(hash)
  if (hash === undefined || size === undefined) return { op: op.op, refused: 'gone' }

  const result = tree.apply(op, context)
  tree.content.set(op.id, { hash, size, front: null, epoch: 0, epochBase: null })
  return result
}

/* ── A v1 app's writes, as ops ─────────────────────────────────────────── */

/** The folders a path names, each found or made, answering the folder the last one is:
 *  what a v1 app's path means in a tree of ids. A folder is found among the live ones,
 *  the way the file list would find it. */
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
  return { folders, name }
}

/** The live note a v1 app's path already names, if there is one: a create at that
 *  path is the 409 it always was, and a Linux device's other spelling of the same
 *  name answers the same way. */
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

/** A note a v1 app made, with its words: a create with a server id, in the folders
 *  its path names. Answers the id, or the note already at that path. */
export async function createByPath(
  env: Env,
  spaceId: string,
  device: string | undefined,
  path: string,
  content: Content,
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

    // Made with words, which is a content change as well as a place.
    const entry = tree.entry(id)
    if (entry) {
      entry.docSeq = entry.seq
      if (device === undefined) delete entry.docBy
      else entry.docBy = device
    }
    return { made: id }
  })
  return value
}

/** A v1 app's rename or move: the note placed at the path it names, its folders found
 *  or made. Answers the path it ended up at, numbered where the name was taken. */
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

/** A v1 app's delete, or a restore out of Recently deleted, as the tree says them. */
export async function deleteById(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  restore = false,
): Promise<OpResult> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) =>
    tree.apply(
      { op: newId(), t: restore ? 'restore' : 'delete', id, seen: SAW_EVERYTHING },
      context,
    ),
  )
  return value
}

/** A document's words changed while it was deleted: it comes back, with its folders
 *  (an edit beats a delete). What a room's settle asks before it writes the words of a
 *  note somebody deleted meanwhile.
 *
 *  A room's words that are the deleting device's own leave it deleted (`own`): they
 *  never stand against its own delete (section 5.9), and a room settles a moment after
 *  the typing, so a note somebody typed in and then moved to another space - a delete
 *  here, the words going with it - came back here once the room caught up, and the
 *  move was a copy (#413). New bytes put on a file are a new file, and bring it back
 *  whoever deleted it. */
export async function revive(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  own: 'stays deleted' | 'comes back' = 'comes back',
): Promise<void> {
  await changeTree(env, spaceId, device, (tree) => {
    const entry = tree.entry(id)
    if (!entry?.deleted) return
    if (own === 'stays deleted' && device !== undefined && entry.by === device) return
    tree.touch(id, device)
  })
}
