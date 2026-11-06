import { FEED_PAGE, type FeedItem, heldName, isEntryId } from '@orden/sync-core'
import type { Env } from '../types'
import { kindOfName } from './tree'
import { prepareSpace } from './prepare'

interface Row {
  id: string
  kind: string
  parent: string | null
  name: string | null
  deleted: number
  seq: number
  doc_seq: number | null
  epoch: number | null
  epoch_base: string | null
  hash: string
  size: number
  by: string | null
  at: number
  folder: number
  pos: string | null
}

const CHANGED = `select * from (
    select id, kind, folder_id as parent, name, deleted, seq, doc_seq, epoch, epoch_base, hash,
           size, updated_by as by, updated_at as at, 0 as folder, pos
      from notes where space_id = ?1 and seq > ?2
    union all
    select id, 'folder', parent_id, name, deleted, seq, null, null, null, '', 0, updated_by,
           updated_at, 1, pos
      from folders where space_id = ?1 and seq > ?2
  ) order by seq limit ?3`

export async function feedPage(
  env: Env,
  spaceId: string,
  since: number,
): Promise<{ items: FeedItem[]; cursor: number; more: boolean; order: true; index: true }> {
  let rows = await changedSince(env, spaceId, since)

  if (rows.some((row) => row.name === null)) {
    await prepareSpace(env, spaceId)
    rows = await changedSince(env, spaceId, since)
  }

  const page = rows.slice(0, FEED_PAGE)
  const safe = (row: Row) =>
    row.deleted === 1 || (isEntryId(row.id) && (row.parent === null || isEntryId(row.parent)))
  return {
    items: page.flatMap((row) =>
      row.name === null || !safe(row)
        ? []
        : [{ ...itemOf(row, row.name), name: heldName(row.name) }],
    ),
    cursor: page.at(-1)?.seq ?? since,
    more: rows.length > FEED_PAGE,
    order: true,
    index: true,
  }
}

function changedSince(env: Env, spaceId: string, since: number): Promise<Row[]> {
  return env.DB.prepare(CHANGED)
    .bind(spaceId, since, FEED_PAGE + 1)
    .all<Row>()
    .then(({ results }) => results)
}

function itemOf(row: Row, name: string): FeedItem {
  const item: FeedItem = {
    id: row.id,
    kind: row.folder ? 'folder' : kindOf(row.kind, name),
    parent: row.parent,
    name,
    deleted: row.deleted === 1,
    seq: row.seq,
    hash: row.hash,
    size: row.size,
    by: row.by ?? '',
    at: row.at,
  }
  if (row.pos !== null) item.pos = row.pos
  if (!row.folder) {
    item.docSeq = row.doc_seq ?? row.seq
    item.epoch = row.epoch ?? 0
    if (row.epoch_base !== null) item.epochBase = row.epoch_base
  }
  return item
}

function kindOf(value: string, name: string): FeedItem['kind'] {
  switch (value) {
    case 'note':
    case 'canvas':
    case 'pages':
    case 'url':
    case 'term':
    case 'chat':
    case 'file':
      return value
    default:
      return kindOfName(name)
  }
}
