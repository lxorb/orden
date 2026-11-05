/** What the account reads off a space's notes for a browser that keeps only some of
 *  their words (#1126): each note's scan, and a search over the rest.
 *
 *  Both read the account's own copy of a note's words - the text every save and every
 *  room's settle writes beside the row (`saveNote` in notes.ts) - and both run the
 *  code the browser runs over the notes it holds (@orden/scan), so a note answers the
 *  same whether a device kept its words or not. Neither wakes a room.
 *
 *  A save writes the row before the words, so a read can meet the row of one save and
 *  the words of the one before. The row's hash says which: words that do not hash to
 *  it are not answered for, and the device asks again. */

import { indexed } from '@orden/scan/indexed'
import type { SearchNote } from '@orden/scan/search/match'
import { walkSearch } from '@orden/scan/search/walk'
import type { FoundHit, FoundLoose, IndexItem, SearchAnswer, SearchRequest } from '@orden/scan/wire'
import { sha256 } from '../crypto'
import { noteKey } from '../notes'
import type { Env } from '../types'

/** How many characters of words one answer reads, at most: past this the rest of a
 *  batch is left for the next request. One note longer than this is still read. */
const MOST_READ = 8 * 1024 * 1024

/** How many notes one search request walks, at most. */
const SEARCH_PAGE = 200

/** How many notes' words are read from the bucket at once. */
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

/** The words of each row whose words are its own, in the order asked; a row whose
 *  words are not there yet, or are another save's, is left out. Stops once `most`
 *  characters are in hand, and says how many of the rows it got through. */
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

/** Whether a path in a space is one of the app's own: under a dotted name. */
function hidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'))
}

/** `POST /v2/spaces/:space/index`: each live document's scan, by id. */
export async function indexItems(
  env: Env,
  spaceId: string,
  ids: readonly string[],
): Promise<IndexItem[]> {
  const { results } = await env.DB.prepare(
    `select id, path, kind, hash, seq, doc_seq, updated_at from notes
      where space_id = ? and deleted = 0 and id in (select value from json_each(?))`,
  )
    .bind(spaceId, JSON.stringify([...new Set(ids)]))
    .all<Row>()

  const items: IndexItem[] = []
  const found = new Set(results.map((row) => row.id))
  for (const id of new Set(ids)) if (!found.has(id)) items.push({ id, refused: 'gone' })

  const rows = results.filter((row) => row.kind !== 'file')
  for (const row of results) {
    // Bytes, not words: a name beside the notes, which is all the index holds of one.
    if (row.kind === 'file') items.push({ id: row.id, docSeq: row.doc_seq ?? row.seq, scan: null })
  }
  for (const { row, text } of (await wordsOf(env, spaceId, rows, MOST_READ)).words) {
    // The account keeps no time a note was made, and a browser's own copy says when it
    // was written there, which is no truer; the time of its words stands for both.
    const stamp = { size: text.length, mtime: row.updated_at, ctime: row.updated_at }
    items.push({ id: row.id, docSeq: row.doc_seq ?? row.seq, scan: indexed(row.path, text, stamp) })
  }
  return items
}

/** `POST /v2/spaces/:space/search`: one page of the space's notes, in id order from
 *  `after`, searched as the browser searches the notes it holds. */
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
  // Where the next page starts: after the last note read where the words filled the
  // answer first, after the page otherwise, and nowhere once the space is walked.
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
