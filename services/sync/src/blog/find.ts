/** Searching a site on the site.
 *
 *  What a reader of a blog wants is the app's search with almost everything
 *  taken away: the words, a phrase in quotes, a word that must not appear, a
 *  tag, a folder. Everything else the app's grammar has - the operators about
 *  tasks, the properties, the regular expressions - is for somebody standing in
 *  their own vault with the whole file tree in front of them, and a stranger
 *  reading three posts has nothing to point them at. So this speaks the part of
 *  the grammar that means the same thing here, and the rest is left out rather
 *  than half-answered; see docs/search.md for the app's own.
 *
 *  Answered by the Worker over an index written when the note was saved, never
 *  by reading a thousand notes out of storage. The index holds every note of the
 *  space and every answer is joined to the pages the site publishes, so a
 *  private note can be in the index and can never be in an answer - which is
 *  the one thing a search on a site must not get wrong.
 *
 *  No script on the page: the box is a form, the answers are a page. A site that
 *  can be searched with scripting off is a site that can be searched. */

import { escape } from './head'

/** How many answers one search gives back. A blog is not a search engine, and
 *  the thirtieth answer to a three-word query is nobody's. */
const MOST_HITS = 30

/** How long a query may be. Past this it is not a query. */
export const LONGEST_QUERY = 200

/** What the reader typed, pulled apart. */
export interface Asked {
  /** Words that must appear. */
  words: string[]
  /** Words in quotes, which must appear in that order. */
  phrases: string[]
  /** Words that must not appear. */
  without: string[]
  /** `tag:` - the note's own tags, from its front matter. */
  tags: string[]
  /** `path:` - a folder, or any part of a path. */
  folders: string[]
}

/** One answer: which note, and the words around the match. */
export interface Hit {
  noteId: string
  /** The matched words with `<mark>` around them, as the index marks them. Safe
   *  to write into the page: everything but those tags is escaped by SQLite's
   *  own snippet, which is given escaped text to begin with. */
  words: string
}

/** A word as FTS5 reads one: quoted, so that a reader typing `AND` or a
 *  bracket searches for the characters rather than steering the query. */
function term(word: string): string {
  return `"${word.replace(/"/g, '""')}"`
}

/** What the reader typed, as the five things it can be.
 *
 *  Written as one pass over the words rather than a parser: the grammar is five
 *  shapes and a parser for it would be a parser to keep in step with the app's
 *  for no reader's benefit. */
export function asked(query: string): Asked {
  const out: Asked = { words: [], phrases: [], without: [], tags: [], folders: [] }
  const said = query.slice(0, LONGEST_QUERY)

  // Phrases first, so their words are not read as loose ones.
  const rest = said.replace(/"([^"]+)"/g, (_whole, inside: string) => {
    const phrase = inside.trim()
    if (phrase) out.phrases.push(phrase)
    return ' '
  })

  for (const raw of rest.split(/\s+/)) {
    const word = raw.trim()
    if (!word) continue

    const tag = /^tag:(.+)$/i.exec(word)
    if (tag?.[1]) {
      out.tags.push(tag[1].replace(/^#/, '').toLowerCase())
      continue
    }

    const folder = /^path:(.+)$/i.exec(word)
    if (folder?.[1]) {
      out.folders.push(folder[1].toLowerCase())
      continue
    }

    if (word.startsWith('-') && word.length > 1) {
      out.without.push(word.slice(1))
      continue
    }

    out.words.push(word)
  }

  return out
}

/** Whether there is anything to ask the index about. A query of nothing but a
 *  tag is answered from the rows alone. */
export function hasWords(one: Asked): boolean {
  return one.words.length > 0 || one.phrases.length > 0
}

/** The query as FTS5 takes it: everything that must appear, then everything that
 *  must not. */
function expression(one: Asked): string {
  const wanted = [...one.phrases.map(term), ...one.words.map(term)].join(' AND ')
  const refused = one.without.map(term).join(' AND ')

  if (!wanted) return ''
  return refused ? `${wanted} NOT (${refused})` : wanted
}

/** The notes of one space whose words match, newest relevance first.
 *
 *  Bounded twice over: the index is asked for a page of answers, and the caller
 *  throws away every answer that is not a published page. Asking for more than
 *  is shown is deliberate - a space of drafts would otherwise answer with
 *  nothing while the index had plenty to say. */
export async function matching(
  env: { DB: D1Database },
  spaceId: string,
  one: Asked,
): Promise<Hit[]> {
  const match = expression(one)
  if (!match) return []

  const { results } = await env.DB.prepare(
    `select note_id as noteId,
            snippet(note_search, 4, '<mark>', '</mark>', '…', 14) as words
       from note_search
      where space_id = ? and note_search match ?
      order by rank
      limit ?`,
  )
    .bind(spaceId, match, MOST_HITS * 4)
    .all<Hit>()

  return results
}

/** The box, on every page of the site.
 *
 *  A form and a field, which is the whole of it: a GET to `/search`, so an
 *  answer is a page with an address somebody can send to somebody else. The
 *  `name` is `q`, because that is what every search box on the web is called and
 *  a reader who edits the address by hand should not have to guess. */
export function searchBox(query: string): string {
  return `<form class="find" method="get" action="/search" role="search">
<input type="search" name="q" value="${escape(query)}" placeholder="Search" aria-label="Search this site" autocomplete="off">
</form>`
}

/** What a page of answers says. The words are the index's own snippet, which is
 *  why they are written as markup rather than escaped again. */
export function answers(
  found: readonly { slug: string; title: string; words: string }[],
  one: Asked,
  query: string,
): string {
  if (!query.trim()) return '<p class="empty">Type something to search for.</p>'
  if (!found.length) return '<p class="empty">Nothing matches.</p>'

  const rows = found
    .slice(0, MOST_HITS)
    .map(
      (hit) =>
        `<li><a href="/${escape(hit.slug)}"><span class="what">${escape(hit.title)}</span>` +
        `<span class="where">${hit.words}</span></a></li>`,
    )
    .join('')

  const said = [
    `${found.length === 1 ? '1 page' : `${found.length} pages`}`,
    ...one.tags.map((tag) => `tagged ${escape(tag)}`),
    ...one.folders.map((folder) => `in ${escape(folder)}`),
  ].join(', ')

  return `<p class="tally">${said}</p><ul class="found">${rows}</ul>`
}
