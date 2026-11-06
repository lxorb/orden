import { escape } from './head'

const MOST_HITS = 30

const MARKED = '\u0001'
const UNMARKED = '\u0002'

function highlighted(words: string): string {
  return escape(words).replaceAll(MARKED, '<mark>').replaceAll(UNMARKED, '</mark>')
}

const LONGEST_QUERY = 200

export interface Asked {
  words: string[]
  phrases: string[]
  without: string[]
  tags: string[]
  folders: string[]
}

export interface Hit {
  noteId: string
  words: string
}

function term(word: string): string {
  return `"${word.replace(/"/g, '""')}"`
}

export function asked(query: string): Asked {
  const out: Asked = { words: [], phrases: [], without: [], tags: [], folders: [] }
  const said = query.slice(0, LONGEST_QUERY)

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

export function hasWords(one: Asked): boolean {
  return one.words.length > 0 || one.phrases.length > 0
}

function expression(one: Asked): string {
  const wanted = [...one.phrases.map(term), ...one.words.map(term)].join(' AND ')
  const refused = one.without.map(term).join(' AND ')

  if (!wanted) return ''
  return refused ? `${wanted} NOT (${refused})` : wanted
}

export async function matching(
  env: { DB: D1Database },
  spaceId: string,
  one: Asked,
): Promise<Hit[]> {
  const match = expression(one)
  if (!match) return []

  const { results } = await env.DB.prepare(
    `select note_id as noteId,
            snippet(note_search, 4, '${MARKED}', '${UNMARKED}', '…', 14) as words
       from note_search
      where space_id = ? and note_search match ?
      order by rank
      limit ?`,
  )
    .bind(spaceId, match, MOST_HITS * 4)
    .all<Hit>()

  return results
}

export function searchBox(query: string): string {
  return `<form class="find" method="get" action="/search" role="search">
<input type="search" name="q" value="${escape(query)}" placeholder="Search" aria-label="Search this site" autocomplete="off">
</form>`
}

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
        `<span class="where">${highlighted(hit.words)}</span></a></li>`,
    )
    .join('')

  const said = [
    found.length === 1 ? '1 page' : `${found.length} pages`,
    ...one.tags.map((tag) => `tagged ${escape(tag)}`),
    ...one.folders.map((folder) => `in ${escape(folder)}`),
  ].join(', ')

  return `<p class="tally">${said}</p><ul class="found">${rows}</ul>`
}
