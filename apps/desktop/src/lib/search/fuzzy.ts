/** Matching a query loosely: the letters in order but not next to each other,
 *  so a typo or a half-remembered word still finds the line.
 *
 *  A term is matched against one line rather than against a whole note. Letters
 *  gathered from across a megabyte are not a match anybody meant, and a line is
 *  also what the panel shows, so the span that scored is the span it emphasises.
 *
 *  The score is fzf's shape: a run of letters next to each other is worth much
 *  more than the same letters apart, a letter that opens a word is worth more
 *  than one inside it, and a gap costs. Which of the several ways a term fits a
 *  line is the one that counts is settled by trying each place its first letter
 *  sits and keeping the best, so `rdm` prefers `read me` to `nerd model`.
 *
 *  fuzzy.rs is the twin of this on the Rust side, down to the cases its tests
 *  use. The desktop's notes are on disk behind the crate and the browser's are
 *  in front of it, so the scan has to live at both ends: two files that score
 *  the same way are the price of not sending a space of notes across the bridge
 *  on every keystroke.
 *
 *  Nothing here allocates per line. A note is folded once and then read through
 *  offsets, because a space of ten thousand notes is fifty megabytes and a
 *  string per line of it is the whole budget. */

import { fold, lineStarts, type Range, type SearchNote } from './match'
import type { Query } from './query'

/** What a matched letter is worth before any bonus, which is fzf's own base.
 *  It keeps a real match's score above zero, so a list cut short reads as the
 *  best of what was found rather than as a column of minus signs. */
const LETTER = 16

/** A letter next to the one before it. The big bonus, and deliberately worth
 *  more than a word start: a term found whole in one word has to beat the same
 *  letters picked one from each of six words, or `quater plan` would rank
 *  `q u a t e r and a plan` alongside `The quarter plan`. */
const RUN = 12

/** A letter that opens a word. What lets initials work: `rdm` finds `read me`
 *  by its word starts rather than by three letters in a row. Doubled for the
 *  first letter of the term, the way fzf weighs it, because where a term begins
 *  says more about the line than where it goes on. */
const START = 8
const FIRST = 2

/** What the first missing letter of a gap costs and what each one after it
 *  costs. Two rates rather than one, so a term broken in two places is worse
 *  than a term broken once by twice as much - fzf's weighting, and the reason
 *  `meting` finds `Meeting` rather than losing to a line that merely holds the
 *  letters. */
const GAP = 3
const GAP_ON = 1

/** Past this a gap is as bad as it gets. Without a floor a match near the end of
 *  a long line would score worse than one that is not a match at all. */
const WORST = 12

/** What ends a word, so the letter after it opens one. A newline is here
 *  because offsets are into the whole note: the first letter of a line opens a
 *  word like the first letter of the note does. */
const BOUNDARY = new Set([
  '\n',
  '\r',
  ' ',
  '\t',
  '/',
  '\\',
  '_',
  '-',
  '.',
  ',',
  ':',
  ';',
  '(',
  '[',
  '{',
  '#',
  '*',
  '>',
  '"',
  "'",
])

/** How much of a line is worth scoring. A line longer than this is a paragraph
 *  nobody wrapped, and the letters at its far end are not what the reader is
 *  pointing at. The panel cuts its preview at 200 for the same reason; this is
 *  wider, so a match just past the preview is still found. */
const SCORED = 400

/** How much of a matching line a row shows. The same cut the exact side makes,
 *  so two rows of one list are trimmed the same way. */
const SHOWN = 200

/** Whether `letter` is one with a small and a capital form, and is the small
 *  one. Reading the pair rather than a range, so it holds outside ASCII. */
function isLower(letter: string): boolean {
  return letter !== '' && letter === letter.toLowerCase() && letter !== letter.toUpperCase()
}

/** Whether the letter at `at` opens a word: the start of the note, a letter
 *  after something that ends a word, or a capital after a small letter, so
 *  `readMe` has two word starts. Read off the note as written, not the folded
 *  copy, which is why the fold keeps its length. */
function opens(body: string, at: number): boolean {
  if (at === 0) return true

  const before = body.charAt(at - 1)
  if (BOUNDARY.has(before)) return true

  return isLower(before) && !isLower(body.charAt(at))
}

/** Where `term`'s letters sit in `folded`, starting at `at` and staying inside
 *  `to`: each letter at the first place it sits after the last. Null when one
 *  of them is not there.
 *
 *  Greedy is what makes this cheap, and the loop in `fitAt` is what makes it
 *  right: every place the first letter sits is tried, so the run the reader
 *  meant is among the ones weighed. */
function walk(term: string, folded: string, at: number, to: number): number[] | null {
  const out = [at]
  let cursor = at + 1

  for (let index = 1; index < term.length; index++) {
    const found = folded.indexOf(term.charAt(index), cursor)
    if (found === -1 || found >= to) return null

    out.push(found)
    cursor = found + 1
  }

  return out
}

/** What one set of positions is worth.
 *
 *  Where in the line the term sits is deliberately not in the number. It is a
 *  tiebreak instead - `fitAt` keeps the earliest of the places that score alike -
 *  the way fzf settles it, because a penalty for sitting late in a line is a
 *  penalty on the second word of every two-word query, and that drowns out what
 *  the bonuses are trying to say. */
function worth(body: string, at: readonly number[]): number {
  let score = at.length * LETTER
  let previous = -2

  for (const [index, position] of at.entries()) {
    if (index > 0 && position === previous + 1) score += RUN
    else if (opens(body, position)) score += START * (index === 0 ? FIRST : 1)

    if (index > 0) score -= gap(position - previous - 1)
    previous = position
  }

  return score
}

/** What `missing` letters skipped between two matches cost. */
function gap(missing: number): number {
  if (missing <= 0) return 0

  const counted = Math.min(missing, WORST)
  return GAP + (counted - 1) * GAP_ON
}

/** The best `term` does inside `body[from, to)`, given the note already
 *  folded, or null when its letters are not all there in order.
 *
 *  `first` is where the term's first letter next sits at or after `from`; the
 *  caller keeps it, because looking it up per line is what turns a long note
 *  into a quadratic one. Hands back the position it stopped at, so the caller's
 *  next line starts from there rather than from its own beginning. */
function fitAt(
  term: string,
  body: string,
  folded: string,
  to: number,
  first: number,
): { score: number; at: number[]; next: number } | null {
  let best: { score: number; at: number[] } | null = null
  let at = first
  let next = first

  while (at !== -1 && at < to) {
    const found = walk(term, folded, at, to)
    // No fit from here means none from any later start either: a later one has
    // fewer letters left in front of it.
    if (!found) break

    const score = worth(body, found)
    // Strictly better, so the earliest of the places that score alike is the one
    // kept; see `worth`.
    if (!best || score > best.score) best = { score, at: found }

    at = folded.indexOf(term.charAt(0), at + 1)
    next = at
  }

  return best ? { ...best, next } : null
}

/** One term against one line: where it sat and what that was worth. What the
 *  scorer's own tests measure, so the ranking rules are checked without a note
 *  around them. */
export function fit(term: string, line: string): { score: number; ranges: Range[] } | null {
  const needle = term.toLowerCase()
  if (!needle) return null

  const text = line.length > SCORED ? line.slice(0, SCORED) : line
  const folded = fold(text)
  const first = folded.indexOf(needle.charAt(0))
  if (first === -1) return null

  const found = fitAt(needle, text, folded, text.length, first)
  return found ? { score: found.score, ranges: ranges(found.at) } : null
}

/** Positions next to each other gathered into the ranges the panel marks. */
function ranges(at: readonly number[]): Range[] {
  const out: Range[] = []

  for (const position of at) {
    const last = out.at(-1)
    if (last?.to === position) last.to = position + 1
    else out.push({ from: position, to: position + 1 })
  }

  return out
}

/** The bare words of a query, folded, when the query is one loose matching can
 *  be asked about at all.
 *
 *  Nothing is relaxed that the reader asked to be exact. A phrase in quotes, a
 *  `/re/`, a `-` that excludes, an `OR`, a nearness group and `case:` are each
 *  somebody being precise, and a loose answer under a precise question is
 *  noise. What is left - bare words, with `path:` `file:` `tag:` and `[key]`
 *  narrowing them - is the ordinary search, and the one a typo lands in. */
export function fuzzyTerms(query: Query): string[] {
  const out: string[] = []
  return gather(query, out) ? out : []
}

/** Fills `out` while the query is still one that can be relaxed. A quoted
 *  phrase and a bare word are both `text` to the parser; the space in one is
 *  what tells them apart. */
function gather(query: Query, out: string[]): boolean {
  switch (query.kind) {
    case 'all':
      return query.of.every((one) => gather(one, out))

    case 'text': {
      if (!query.fold || /\s/.test(query.text)) return false

      out.push(fold(query.text))
      return true
    }

    // These ask about the note rather than about its words, so they go on
    // asking exactly while the words beside them are relaxed.
    case 'path':
    case 'file':
    case 'tag':
    case 'property':
      return true

    case 'any':
    case 'not':
    case 'regex':
    case 'scope':
      return false
  }
}

/** The same query with its bare words taken out: what a note has to answer
 *  before its lines are worth scoring. `path:` and its kind stay, so a narrowed
 *  search stays narrowed; a query of nothing but words becomes the empty `all`,
 *  which every note answers. */
export function withoutWords(query: Query): Query {
  if (query.kind === 'text') return { kind: 'all', of: [] }
  if (query.kind !== 'all') return query

  return { kind: 'all', of: query.of.filter((one) => one.kind !== 'text').map(withoutWords) }
}

/** A note's best loose line, ready for a row in the panel. The same shape the
 *  exact side sends, with the score that ordered it. */
export interface FuzzyHit {
  path: string
  name: string
  line: number
  text: string
  ranges: Range[]
  score: number
}

/** A query's loose terms, asked about one note at a time.
 *
 *  Built once per search, with the terms already folded, so a space of ten
 *  thousand notes folds a handful of words rather than folding them ten
 *  thousand times. */
export class Fuzzy {
  constructor(private readonly terms: readonly string[]) {}

  get asks(): boolean {
    return this.terms.length > 0
  }

  /** The note's best line, or null when no single line holds every term.
   *
   *  One line rather than all of them: a loose match is a guess, and a guess is
   *  worth one row. A note that deserves more rows is one the exact search has
   *  already found. */
  best(note: SearchNote): FuzzyHit | null {
    if (!this.terms.length) return null

    const body = note.body
    const folded = fold(body)
    const starts = lineStarts(body)

    // Where each term's first letter next sits. Only ever moves forward, so
    // the whole note costs one pass per term rather than one pass per line.
    const next = this.terms.map((term) => folded.indexOf(term.charAt(0)))
    if (next.some((at) => at === -1)) return null

    let bestScore = 0
    let bestAt = -1
    let bestPositions: number[] = []

    for (const [index, from] of starts.entries()) {
      const after = starts[index + 1]
      const end = after === undefined ? body.length : after - 1
      const to = Math.min(end, from + SCORED)
      if (to <= from) continue

      let score = 0
      const positions: number[] = []
      let all = true

      for (const [which, term] of this.terms.entries()) {
        let at = next[which] ?? -1
        if (at < from) {
          at = folded.indexOf(term.charAt(0), from)
          // Gone for the rest of the note, so no later line can hold the term
          // either and the note is answered.
          if (at === -1) return this.done(note, starts, bestAt, bestScore, bestPositions)
          next[which] = at
        }

        if (at >= to) {
          all = false
          break
        }

        const found = fitAt(term, body, folded, to, at)
        if (found) next[which] = found.next === -1 ? body.length : found.next
        if (!found) {
          all = false
          break
        }

        score += found.score
        positions.push(...found.at)
      }

      if (!all) continue
      if (bestAt !== -1 && score <= bestScore) continue

      bestScore = score
      bestAt = index
      bestPositions = positions
    }

    return this.done(note, starts, bestAt, bestScore, bestPositions)
  }

  private done(
    note: SearchNote,
    starts: readonly number[],
    line: number,
    score: number,
    positions: readonly number[],
  ): FuzzyHit | null {
    return line === -1 ? null : this.row(note, starts, line, score, positions)
  }

  /** The line as a row shows it, with the marks moved to where trimming left
   *  them. The exact side's `row` does the same for its own hits, cutting at
   *  the same place, so one list reads as one list. */
  private row(
    note: SearchNote,
    starts: readonly number[],
    line: number,
    score: number,
    positions: readonly number[],
  ): FuzzyHit {
    const from = starts[line] ?? 0
    const next = starts[line + 1]
    const raw = note.body.slice(from, next === undefined ? note.body.length : next - 1)
    const lead = raw.length - raw.trimStart().length
    const text = Array.from(raw.trim()).slice(0, SHOWN).join('')

    const moved: Range[] = []
    for (const range of ranges([...positions].sort((a, b) => a - b))) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start >= end) continue

      const last = moved.at(-1)
      if (last && last.to >= start) last.to = Math.max(last.to, end)
      else moved.push({ from: start, to: end })
    }

    return { path: note.path, name: note.name, line, text, ranges: moved, score }
  }
}
