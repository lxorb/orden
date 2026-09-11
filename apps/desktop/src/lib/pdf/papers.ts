/** The words of the papers that have been read, and searching them.
 *
 *  A paper is not a note: its words are inside a PDF, and getting at them is
 *  pdf.js, a worker and a page at a time. So the space search cannot walk them the
 *  way it walks notes - neither the crate nor the browser's own walk has anything
 *  to read - and the rule this settles on is the honest one:
 *
 *  **nib searches the papers you have read.** A page's words are taken down when
 *  the viewer reads them, which it does anyway for its own find bar, and they stay
 *  for the rest of the session. So opening a paper once makes it answerable, and no
 *  search ever waits for a PDF to be taken apart.
 *
 *  What was refused, and why. Reading every PDF in a space when a search runs
 *  would make the first search of a space with twenty papers a minute long, which
 *  is not a search. Reading them all in the background at launch would spend that
 *  minute on every launch whether anybody searched or not. And a cache on disk
 *  keyed by the file's hash - which is what would survive a restart - wants a place
 *  to put megabytes on both builds; that is a follow-up with a shape rather than
 *  something to write blind.
 *
 *  Matching itself is the shared matcher, so a query means the same thing in a
 *  paper as in a note. Only the rows are built here: a page has no lines, so the
 *  words around the match are what a row shows. */

import { type Hit, Matcher } from '../search/match'
import type { Query } from '../search/query'

/** Every page of every paper read this session, by the paper's path. */
const read = new Map<string, Map<number, string>>()

/** How much of a page a row shows, and how much of it comes before the match. A
 *  page is one long run of words, so unlike a note's line there is no natural end
 *  to cut at: the row is a window, and the match sits inside it rather than at the
 *  start of it. */
const WINDOW = 180
const BEFORE = 60

/** A page's words, as the viewer read them.
 *
 *  The runs are joined with a space rather than with nothing: `textOfRuns` joins
 *  them tight because the find bar counts characters against what is painted, and
 *  nothing here is painted. A space is what keeps two runs from making one word
 *  that neither of them says. */
export function paperRead(path: string, page: number, runs: readonly string[]): void {
  const held = read.get(path) ?? new Map<number, string>()
  held.set(page, runs.join(' '))
  read.set(path, held)
}

/** Forgets a paper, for one that has been renamed, moved or deleted. */
export function paperGone(path: string): void {
  read.delete(path)
}

/** How many papers have words worth searching. For the drive, and for a test. */
export function papersRead(): number {
  return read.size
}

/** The words around one match, and where the match sits in them. */
function windowOf(body: string, from: number): { text: string; at: number } {
  const start = Math.max(0, from - BEFORE)
  const cut = body.slice(start, start + WINDOW)
  const lead = cut.length - cut.trimStart().length
  const text = cut.trim()

  return { text, at: from - start - lead }
}

/** Whether a paper is one the space leaves out: the path itself, or something
 *  inside a folder that is. The same reading the notes get. */
function leftOut(relative: string, excluded: readonly string[]): boolean {
  return excluded.some((one) => relative === one || relative.startsWith(`${one}/`))
}

/** What the papers of one space answer, as the rows the panel draws.
 *
 *  A row carries its page rather than a line, which is what says it is a paper: the
 *  panel opens it there, and a paper has no lines to go to. */
export function searchPapers(
  root: string,
  query: Query,
  limit: number,
  excluded: readonly string[] = [],
): Hit[] {
  if (!read.size || limit <= 0) return []

  const matcher = new Matcher(query)
  const out: Hit[] = []
  const inside = root.endsWith('/') ? root : `${root}/`

  for (const [path, pages] of read) {
    if (out.length >= limit) break
    if (!path.startsWith(inside)) continue

    const relative = path.slice(inside.length)
    if (leftOut(relative, excluded)) continue

    const name = relative.split('/').pop() ?? relative

    for (const [page, body] of [...pages].sort((one, other) => one[0] - other[0])) {
      if (out.length >= limit) break
      if (!body.trim()) continue

      const spans = matcher.spans({ path, relative, name, body })
      if (!spans) continue

      // A page answers once: it is one place in the paper, and a row per word
      // found on it would be a page of rows about one page.
      const first = spans[0]
      const { text, at } = first
        ? windowOf(body, first.from)
        : { text: body.slice(0, WINDOW).trim(), at: -1 }

      const length = first ? first.to - first.from : 0
      out.push({
        path,
        name,
        page,
        // A paper has no lines. Nothing reads this for a paper - the page is what
        // opens one - and zero is what a row with no line says.
        line: 0,
        text,
        ranges: at >= 0 && length > 0 ? [{ from: at, to: at + length }] : [],
      })
    }
  }

  return out
}

/** For the tests: nothing read, as at launch. */
export function forgetPapers(): void {
  read.clear()
}
