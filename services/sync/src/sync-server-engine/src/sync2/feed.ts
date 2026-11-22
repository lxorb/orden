import { FEED_PAGE, heldName, isEntryId, metaFromText, type FeedItem } from '@orden/sync-core'
import { type Env, makerOf, webNoteIn } from '../../../sync-server/src/api'
import { KEPT, kindOfName } from './tree'
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
  meta: string | null
  maker: string | null
}
type Fed = FeedItem & { own?: true }
const CHANGED = `select * from (
    select id, kind, folder_id as parent, name, deleted, seq, doc_seq, epoch, epoch_base, hash,
           size, updated_by as by, updated_at as at, 0 as folder, pos, meta,
           case when ${webNoteIn('notes')} then ${makerOf('notes')} end as maker
      from notes where space_id = ?1 and seq > ?2 and (name is not null or ${KEPT})
    union all
    select id, 'folder', parent_id, name, deleted, seq, null, null, null, '', 0, updated_by,
           updated_at, 1, pos, meta, null
      from folders where space_id = ?1 and seq > ?2
  ) order by seq limit ?3`
export async function feedPage(
  env: Env,
  spaceId: string,
  since: number,
  viewer: string,
): Promise<{
  items: Fed[]
  cursor: number
  more: boolean
  order: true
  meta: true
  index: true
  owns: true
}> {
  let rows = await changedSince(env, spaceId, since)
  if (rows.some((row) => row.name === null)) {
    await prepareSpace(env, spaceId)
    rows = await changedSince(env, spaceId, since)
  }
  const whole = rows.slice(0, FEED_PAGE)
  const unnamed = whole.findIndex((row) => row.name === null)
  const page = unnamed === -1 ? whole : whole.slice(0, unnamed)
  const safe = (row: Row) => row.deleted === 1 || (isEntryId(row.id) && (row.parent === null || isEntryId(row.parent)))
  return {
    items: page.flatMap((row): Fed[] => {
      if (row.name === null || !safe(row)) return []
      if (row.maker !== null && row.maker !== viewer) return [keptAway(row)]
      const item = { ...itemOf(row, row.name), name: heldName(row.name) }
      return [row.maker === null ? item : { ...item, own: true }]
    }),
    cursor: page.at(-1)?.seq ?? since,
    more: unnamed === -1 ? rows.length > FEED_PAGE : page.length > 0,
    order: true,
    meta: true,
    index: true,
    owns: true,
  }
}
function changedSince(env: Env, spaceId: string, since: number): Promise<Row[]> {
  return env.DB.prepare(CHANGED)
    .bind(spaceId, since, FEED_PAGE + 1)
    .all<Row>()
    .then(({ results }) => results)
}
function keptAway(row: Row): FeedItem {
  return {
    id: row.id,
    kind: 'url',
    parent: null,
    name: row.id,
    deleted: true,
    seq: row.seq,
    hash: '',
    size: 0,
    by: '',
    at: row.at,
  }
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
  const meta = metaFromText(row.meta)
  if (meta) item.meta = meta
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
