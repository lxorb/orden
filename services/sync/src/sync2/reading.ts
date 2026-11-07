import { indexed } from '@orden/scan/indexed'
import type { SearchNote } from '@orden/scan/search/match'
import { walkSearch } from '@orden/scan/search/walk'
import type { FoundHit, FoundLoose, IndexItem, SearchAnswer, SearchRequest } from '@orden/scan/wire'
import { sha256 } from '../crypto'
import { noteKey } from '../notes'
import type { Env } from '../types'

const MOST_READ = 8 * 1024 * 1024

const SEARCH_PAGE = 200

const AT_ONCE = 6

interface Row {
  id: string
  path: string
  kind: string
  hash: string
  seq: number
  doc_seq: number | null
  updated_at: number
}

async function wordsOf(
  env: Env,
  spaceId: string,
  rows: readonly Row[],
  most: number,
): Promise<{ words: { row: Row; text: string }[]; through: number }> {
  const words: { row: Row; text: string }[] = []
  let read = 0
  let through = 0
  while (through < rows.length && read < most) {
    const some = rows.slice(through, through + AT_ONCE)
    const texts = await Promise.all(
      some.map(async (row) => {
        const object = await env.NOTES.get(noteKey(spaceId, row.id))
        return object ? await object.text() : null
      }),
    )
    for (const [index, row] of some.entries()) {
      const text = texts[index] ?? null
      if (text === null || (await sha256(text)) !== row.hash) continue
      words.push({ row, text })
      read += text.length
    }
    through += some.length
  }
  return { words, through }
}

function hidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'))
}

export async function indexItems(
  env: Env,
  spaceId: string,
  ids: readonly string[],
): Promise<IndexItem[]> {
  const { results } = await env.DB.prepare(
    `select id, path, kind, hash, seq, doc_seq, updated_at from notes
      where id in (select value from json_each(?)) and +space_id = ? and deleted = 0`,
  )
    .bind(JSON.stringify([...new Set(ids)]), spaceId)
    .all<Row>()

  const items: IndexItem[] = []
  const found = new Set(results.map((row) => row.id))
  for (const id of new Set(ids)) if (!found.has(id)) items.push({ id, refused: 'gone' })

  const rows = results.filter((row) => row.kind !== 'file')
  for (const row of results) {
    if (row.kind === 'file') items.push({ id: row.id, docSeq: row.doc_seq ?? row.seq, scan: null })
  }
  for (const { row, text } of (await wordsOf(env, spaceId, rows, MOST_READ)).words) {
    const stamp = { size: text.length, mtime: row.updated_at, ctime: row.updated_at }
    items.push({ id: row.id, docSeq: row.doc_seq ?? row.seq, scan: indexed(row.path, text, stamp) })
  }
  return items
}

export async function searchPage(
  env: Env,
  spaceId: string,
  request: SearchRequest,
): Promise<SearchAnswer> {
  const { results } = await env.DB.prepare(
    `select id, path, kind, hash, seq, doc_seq, updated_at from notes
      where space_id = ? and deleted = 0 and kind = 'note' and id > ? order by id limit ?`,
  )
    .bind(spaceId, request.after ?? '', SEARCH_PAGE)
    .all<Row>()

  const skipped = new Set(request.skip ?? [])
  const asked = results.filter(
    (row) =>
      !skipped.has(row.id) && !hidden(row.path) && /\.(md|markdown|mdown|mkd)$/i.test(row.path),
  )
  const { words: read, through } = await wordsOf(env, spaceId, asked, MOST_READ)
  const after =
    through < asked.length
      ? (asked[through - 1]?.id ?? null)
      : results.length < SEARCH_PAGE
        ? null
        : (results.at(-1)?.id ?? null)

  const ids = new Map<SearchNote, string>()
  const notes = read.map(({ row, text }) => {
    const note: SearchNote = {
      path: row.path,
      relative: row.path,
      name: row.path.split('/').pop() ?? row.path,
      body: text,
    }
    ids.set(note, row.id)
    return note
  })
  const byPath = new Map(notes.map((note) => [note.path, ids.get(note) ?? '']))

  const hits: FoundHit[] = []
  const loose: FoundLoose[] = []
  await walkSearch(
    (visit) => {
      for (const note of notes) if (!visit(note)) break
      return Promise.resolve()
    },
    request.query,
    request.terms,
    request.limit,
    (found) => {
      for (const hit of found.hits) hits.push({ ...hit, id: byPath.get(hit.path) ?? '' })
      for (const hit of found.loose) loose.push({ ...hit, id: byPath.get(hit.path) ?? '' })
    },
    request.excluded ?? [],
  )
  return { hits, loose, after }
}
