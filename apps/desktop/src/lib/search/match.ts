/** Running a parsed query over one note: whether it answers, and where.
 *
 *  Every operator answers with the places it matched rather than with a yes,
 *  which is what lets a hit emphasise the words that were found and what lets
 *  a replacement know exactly what to put back. An operator that asks about
 *  the note rather than its words - `path:`, `file:`, `tag:`, `[key]` - answers
 *  with no places at all, so a note found only by its name still counts as
 *  found and simply has nothing to underline.
 *
 *  A term is looked for inside a region, and `line:` `block:` `section:` are
 *  nothing more than the same walk over a smaller one. That is the whole of
 *  nearness here: one recursion, no second pass.
 *
 *  query.rs is the twin of this on the Rust side, and match.test.ts holds the
 *  two to the same answers. */

import type { Query, Unit } from './query'
import { tagsIn } from './tags'

export interface SearchNote {
  /** What opening the hit asks for: the note's path as this machine spells it. */
  path: string
  /** How `path:` reads the note: relative to the space, `/`-separated. */
  relative: string
  name: string
  body: string
}

export interface Range {
  from: number
  to: number
}

/** Where one match sits, and what a `/re/` caught on the way, so a replacement
 *  can put `$1` back. */
export interface Span extends Range {
  groups?: readonly string[]
}

export interface Hit {
  path: string
  name: string
  line: number
  /** The line as a row shows it: trimmed, and cut short. */
  text: string
  /** Where in `text` the match sits. Empty for a note found by its path, its
   *  name or a tag, which no line of it says. */
  ranges: Range[]
}

/** How much of a matching line is worth showing. The Rust side cuts here too. */
const LINE = 200

const HEADING = /^ {0,3}#{1,6}(\s|$)/

/** Lowercase without changing the length, so an offset in the folded text is
 *  the same offset in the note. A handful of letters lowercase into two - the
 *  Turkish dotted capital I among them - and those are left as they are rather
 *  than shifting every match after them by one. */
function fold(text: string): string {
  let out = ''

  for (const letter of text) {
    const lower = letter.toLowerCase()
    out += lower.length === letter.length ? lower : letter
  }

  return out
}

/** Where every line of a note starts. Built once per note that has a hit. */
export function lineStarts(body: string): number[] {
  const starts = [0]
  for (let at = body.indexOf('\n'); at !== -1; at = body.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }

  return starts
}

/** Which line an offset is on. A search rather than a walk, because a replace
 *  asks it once per match and a note can be long. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }

  return low
}

/** The regions a `line:` `block:` or `section:` group looks inside. */
function unitsIn(body: string, unit: Unit): Range[] {
  const starts = lineStarts(body)
  const ends = starts.map((_start, index) => {
    const next = starts[index + 1]
    return next === undefined ? body.length : next - 1
  })

  if (unit === 'line') {
    return starts.map((from, index) => ({ from, to: ends[index] ?? body.length }))
  }

  const out: Range[] = []
  let open: number | null = null

  const close = (to: number) => {
    if (open !== null) out.push({ from: open, to })
    open = null
  }

  for (const [index, start] of starts.entries()) {
    const end = ends[index] ?? body.length
    const text = body.slice(start, end)

    if (unit === 'block') {
      // A paragraph is what blank lines leave between them.
      if (text.trim() === '') close(ends[index - 1] ?? start)
      else open ??= start
      continue
    }

    // A section runs from a heading to the next one, and whatever comes before
    // the first heading is a section of its own.
    if (HEADING.test(text)) {
      close(ends[index - 1] ?? start)
      open = start
    } else open ??= start
  }

  close(body.length)
  return out
}

/** Front matter as a map, for `[key]` and `[key:value]`.
 *
 *  The plain `key: value` lines at the top and nothing else. A value written
 *  as a list underneath its key is left out: reading YAML properly is a
 *  parser, and the operator is worth a few lines, not a dependency. */
function frontMatter(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = body.split('\n')
  if (lines[0]?.trim() !== '---') return out

  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    if (/^\s/.test(line)) continue

    const colon = line.indexOf(':')
    if (colon <= 0) continue

    out.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }

  return out
}

/** What one note costs to answer about, worked out the first time it is asked
 *  for and not at all when the query never asks. */
interface Facts {
  note: SearchNote
  folded: string | null
  tags: string[] | null
  front: Map<string, string> | null
  units: Partial<Record<Unit, Range[]>>
}

function foldedOf(facts: Facts): string {
  return (facts.folded ??= fold(facts.note.body))
}

function tagsOf(facts: Facts): string[] {
  return (facts.tags ??= tagsIn(facts.note.body).map((tag) => tag.slice(1).toLowerCase()))
}

function frontOf(facts: Facts): Map<string, string> {
  return (facts.front ??= frontMatter(facts.note.body))
}

function unitsOf(facts: Facts, unit: Unit): Range[] {
  return (facts.units[unit] ??= unitsIn(facts.note.body, unit))
}

/** Whether a short string holds another. Plain lowercasing rather than the
 *  length-preserving fold above: nothing here is an offset into a note, so a
 *  letter that lowercases into two may as well do so. */
function contains(hay: string, needle: string, folded: boolean): boolean {
  return folded ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle)
}

/** Every place a plain word or phrase sits inside the region, without
 *  overlapping itself, so replacing them all is a matter of splicing. */
function literals(hay: string, needle: string, region: Range): Span[] | null {
  if (!needle) return null

  const out: Span[] = []
  let at = hay.indexOf(needle, region.from)

  while (at !== -1 && at + needle.length <= region.to) {
    out.push({ from: at, to: at + needle.length })
    at = hay.indexOf(needle, at + needle.length)
  }

  return out.length ? out : null
}

/** The two regions overlapping, or null when they do not. */
function clip(one: Range, other: Range): Range | null {
  const from = Math.max(one.from, other.from)
  const to = Math.min(one.to, other.to)
  return from <= to ? { from, to } : null
}

/** A note, a query, and the compiled patterns the query needs.
 *
 *  Built once per search and asked about every note, so a `/re/` is compiled
 *  once for the whole space rather than once per note. */
export class Matcher {
  private readonly patterns = new Map<string, RegExp | null>()
  private readonly needles = new Map<string, string>()

  constructor(private readonly query: Query) {}

  /** Every place the note answers the query, or null when it does not. */
  spans(note: SearchNote): Span[] | null {
    const facts: Facts = { note, folded: null, tags: null, front: null, units: {} }
    return this.walk(this.query, facts, { from: 0, to: note.body.length })
  }

  /** The note's matching lines, ready for a row in the panel. */
  hits(note: SearchNote, most: number): Hit[] {
    const spans = this.spans(note)
    if (!spans || most <= 0) return []

    const starts = lineStarts(note.body)

    // Found by something no line of the note says: its path, its name, a tag.
    // The first line with words in it stands in, so the row reads like a note
    // rather than like an empty result.
    if (!spans.length) {
      const line = starts.findIndex((start, index) =>
        note.body.slice(start, starts[index + 1] ?? note.body.length).trim(),
      )

      return [this.row(note, starts, Math.max(line, 0), [])]
    }

    const byLine = new Map<number, Range[]>()
    for (const span of [...spans].sort((a, b) => a.from - b.from)) {
      const line = lineAt(starts, span.from)
      const held = byLine.get(line)
      if (held) held.push(span)
      else byLine.set(line, [span])
    }

    return [...byLine.entries()]
      .slice(0, most)
      .map(([line, ranges]) => this.row(note, starts, line, ranges))
  }

  /** One line as a row: the words trimmed and cut short, and the match moved
   *  to where it ended up in them. */
  private row(note: SearchNote, starts: readonly number[], line: number, ranges: Range[]): Hit {
    const from = starts[line] ?? 0
    const next = starts[line + 1]
    const raw = note.body.slice(from, next === undefined ? note.body.length : next - 1)
    const lead = raw.length - raw.trimStart().length
    // Whole characters, so a row cut short never ends inside one. The Rust
    // side counts the same way.
    const text = Array.from(raw.trim()).slice(0, LINE).join('')

    const moved: Range[] = []
    for (const range of ranges) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start < end) moved.push({ from: start, to: end })
    }

    return { path: note.path, name: note.name, line, text, ranges: moved }
  }

  private walk(query: Query, facts: Facts, region: Range): Span[] | null {
    switch (query.kind) {
      case 'all': {
        const out: Span[] = []
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) return null
          out.push(...found)
        }

        return out
      }

      case 'any': {
        const out: Span[] = []
        let answered = false
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) continue

          answered = true
          out.push(...found)
        }

        return answered ? out : null
      }

      case 'not':
        return this.walk(query.of, facts, region) ? null : []

      case 'text': {
        const needle = query.fold ? this.folded(query.text) : query.text
        return literals(query.fold ? foldedOf(facts) : facts.note.body, needle, region)
      }

      case 'regex':
        return this.matches(query.source, query.fold, facts.note.body, region)

      case 'path':
        return contains(facts.note.relative, query.text, query.fold) ? [] : null

      case 'file':
        return contains(facts.note.name, query.text, query.fold) ? [] : null

      case 'tag': {
        const wanted = query.tag.toLowerCase()
        // A tag stands for its children too, the way Obsidian reads it, so
        // `tag:work` finds `#work/2026`.
        const has = tagsOf(facts).some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))

        return has ? [] : null
      }

      case 'property': {
        const value = frontOf(facts).get(query.name)
        if (value === undefined) return null

        return query.value === null || contains(value, query.value, true) ? [] : null
      }

      case 'scope': {
        const out: Span[] = []
        let answered = false

        for (const unit of unitsOf(facts, query.unit)) {
          const within = clip(unit, region)
          if (!within) continue

          const found = this.walk(query.of, facts, within)
          if (!found) continue

          answered = true
          out.push(...found)
        }

        return answered ? out : null
      }
    }
  }

  private folded(text: string): string {
    const held = this.needles.get(text)
    if (held !== undefined) return held

    const made = fold(text)
    this.needles.set(text, made)
    return made
  }

  /** A pattern that will not compile matches nothing. It is a query still
   *  being typed, not something to report. */
  private pattern(source: string, folded: boolean): RegExp | null {
    const key = `${folded ? 'i' : ''} ${source}`
    const held = this.patterns.get(key)
    if (held !== undefined) return held

    let made: RegExp | null
    try {
      made = new RegExp(source, folded ? 'gi' : 'g')
    } catch {
      made = null
    }

    this.patterns.set(key, made)
    return made
  }

  /** Every place the pattern matches inside the region. The region is what is
   *  searched, so `^` and `$` mean the start and the end of a line inside
   *  `line:(…)` and the start and the end of the note outside it. */
  private matches(source: string, folded: boolean, body: string, region: Range): Span[] | null {
    const pattern = this.pattern(source, folded)
    if (!pattern) return null

    const whole = region.from === 0 && region.to === body.length
    const text = whole ? body : body.slice(region.from, region.to)
    const out: Span[] = []
    pattern.lastIndex = 0

    for (;;) {
      const found = pattern.exec(text)
      if (!found) break

      const from = found.index
      const to = from + found[0].length

      // A pattern that can match nothing would sit on the same place forever,
      // and an empty match is not a place to show or to replace.
      if (to === from) {
        pattern.lastIndex = from + 1
        continue
      }

      out.push({
        from: region.from + from,
        to: region.from + to,
        groups: Array.from({ length: found.length - 1 }, (_, index) => found[index + 1] ?? ''),
      })

      pattern.lastIndex = to
    }

    return out.length ? out : null
  }
}
