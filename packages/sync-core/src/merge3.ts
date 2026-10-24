/** Two sets of edits to one text, laid side by side against the text they were both
 *  made on.
 *
 *  This is the half of `diff3` nib needs: not a merge to trust - the CRDT merges,
 *  character by character, with nothing fuzzy about it - but the map of where two
 *  sides wrote, so the classifier can say whether a merge is silent, quietly settled,
 *  or a question (docs/sync-v2.md section 5.4). Each side is diffed against the
 *  ancestor with the semantic cleanup, so a rewritten sentence reads as one edit
 *  rather than as twenty letters that happen to survive, and every edit is in the
 *  ancestor's coordinates, where the two sides can be compared.
 *
 *  Three things can happen where the two meet:
 *
 *  - **the same edit on both sides** (both fixed the typo) counts once;
 *  - **insertions at one point** (both appended to the list) are both kept, which is
 *    not a conflict at all - unless they share more than a line of words, which is one
 *    passage put back or written twice, and meets like an overlap;
 *  - **edits that overlap** - spans that intersect, or an insertion strictly inside a
 *    span the other side replaced - form a meeting, joined transitively, whose size is
 *    what both sides wrote there plus the ancestor text they cover;
 *  - **edits in one line** that would together make a line neither side wrote - whole
 *    lines taken out or put in where the other side wrote inside one, a line rewritten
 *    on one side and written in on the other - meet the same way (`sameLine`). Words
 *    beside words in one line are still both kept.
 *
 *  The text this assembles is the pure merge: everything that meets nothing applied,
 *  identical edits once, and each meeting as the caller decides. The classifier uses
 *  it where it has no CRDT text to hand, and as the reference the simulator checks
 *  the CRDT against. */

import { edits, wordEdits } from './diff'

/** A stretch of a text, as UTF-16 offsets, `to` exclusive. */
export interface Span {
  from: number
  to: number
}

/** One side's change to the ancestor, in the ancestor's coordinates: `from` to `to`
 *  of the ancestor reads `insert` on that side. A pure insertion has `from === to`. */
export interface Edit extends Span {
  insert: string
}

/** Which of the two sides: this device's (L) or the account's (R). */
export type Whose = 'local' | 'remote'

/** Edits of the two sides that meet: spans that intersect, or an insertion strictly
 *  inside a span the other side replaced, closed over transitively. */
export interface Meeting {
  /** The ancestor passage the edits cover, together. */
  base: Span
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Characters of both sides' replacements plus the ancestor text they cover. */
  size: number
}

/** How a meeting is written into the merge: as one side wrote it, or as a CRDT would
 *  leave it, with both sides' deletions made and both sides' insertions kept. */
export type Settle = Whose | 'both'

/** Where two sides wrote, before anything is decided about it. */
export interface Analysis {
  /** The ancestor to the local text, and to the remote one, each in order. */
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Edits both sides made the same way. */
  identical: readonly Edit[]
  meetings: readonly Meeting[]
  /** The edits of each side that meet nothing and are not identical to the other's. */
  alone: { local: readonly Edit[]; remote: readonly Edit[] }
}

export interface Merged extends Analysis {
  /** The three-way merge: every edit that meets nothing applied, identical ones
   *  once, insertions at one point local first, and each meeting as `settle` said. */
  text: string
}

function isInsertion(edit: Edit): boolean {
  return edit.from === edit.to
}

function sameEdit(one: Edit, other: Edit): boolean {
  return one.from === other.from && one.to === other.to && one.insert === other.insert
}

/** How many characters of whole words two insertions have in common. Asked with the
 *  two in one order whichever side each came from, because a diff may line up
 *  repeated words differently read the other way round, and which side is local must
 *  never change a verdict. */
function shared(one: string, other: string): number {
  const [first, second] = one < other ? [one, other] : [other, one]
  return wordEdits(first, second).reduce((left, edit) => left - (edit.to - edit.from), first.length)
}

/** More words than this in common, and two insertions at one point are one passage
 *  written twice rather than two things added side by side. The block rule's number:
 *  about a line. */
const ONE_PASSAGE = 16

/** The fewest characters one side's words may be for them to count as a passage the
 *  other side wrote too, when the other side's words hold them whole: two short words. */
const HELD_WHOLE = 8

/** Whether two sides' words at one point are one passage written twice: more than a
 *  line of words in common, or the one wholly inside the other - two devices that each
 *  put back the same few words over a deletion, one of them with more after it. */
function samePassage(one: string, other: string): boolean {
  if (shared(one, other) > ONE_PASSAGE) return true
  const [shorter, longer] = one.trim().length <= other.trim().length ? [one, other] : [other, one]
  const words = shorter.trim()
  return words.length >= HELD_WHOLE && longer.includes(words)
}

/** Whether an edit of one side and an edit of the other overlap. Two insertions at
 *  one point do not, and both are kept (both appended to the list) - unless they are
 *  one passage written twice (`samePassage`), the same passage put back or written
 *  twice, and keeping both would say it twice. An insertion at the very edge of a span
 *  the other side replaced does not overlap either: it is beside the replacement, not
 *  in it - unless, again, it is the replacement's own words written twice. */
function meets(one: Edit, other: Edit): boolean {
  if (isInsertion(one) && isInsertion(other)) {
    return one.from === other.from && samePassage(one.insert, other.insert)
  }
  const [insertion, span] = isInsertion(one) ? [one, other] : [other, one]
  if (isInsertion(insertion)) {
    if (span.from < insertion.from && insertion.from < span.to) return true
    const edge = insertion.from === span.from || insertion.from === span.to
    return edge && samePassage(insertion.insert, span.insert)
  }
  return one.from < other.to && other.from < one.to
}

/** Where a line of `base` that holds `at` begins. */
function lineStart(base: string, at: number): number {
  return at === 0 ? 0 : base.lastIndexOf('\n', at - 1) + 1
}

/** Where a line of `base` that holds `at` ends, its newline included. */
function lineEnd(base: string, at: number): number {
  const newline = base.indexOf('\n', at)
  return newline === -1 ? base.length : newline + 1
}

/** Whether an edit is made of whole lines: it starts where a line does, takes out
 *  whole lines if anything, and puts in whole lines if anything. Such an edit sits
 *  between the lines around it; any other is inside a line. */
function wholeLines(base: string, edit: Edit): boolean {
  const ends = edit.to === edit.from || edit.to === base.length || base.charAt(edit.to - 1) === '\n'
  return (
    lineStart(base, edit.from) === edit.from &&
    ends &&
    (edit.insert === '' || edit.insert.endsWith('\n'))
  )
}

/** The lines an edit is written into: its own span when it is whole lines, else every
 *  line it touches, the next one too when it takes a line's newline away and puts none
 *  back, joining the two. */
function reach(base: string, edit: Edit): Span {
  if (wholeLines(base, edit)) return { from: edit.from, to: edit.to }
  const keepsEnd =
    edit.to > edit.from && base.charAt(edit.to - 1) === '\n' && edit.insert.endsWith('\n')
  return {
    from: lineStart(base, edit.from),
    to: lineEnd(base, keepsEnd ? edit.to - 1 : edit.to),
  }
}

/** Whether an edit takes a line break out or puts one in. */
function breaks(base: string, edit: Edit): boolean {
  return edit.insert.includes('\n') || base.slice(edit.from, edit.to).includes('\n')
}

const WORDY = /[\p{L}\p{N}]/u

/** For each of a side's edits, whether its line is rewritten: the side's edits
 *  inside that line leave none of the line's words, or the line had none yet. */
function rewrittenLines(base: string, side: readonly Edit[]): boolean[] {
  const out = side.map(() => false)
  let first = 0
  while (first < side.length) {
    const edit = side[first]
    if (!edit) break
    // The side's edits that start inside the lines this one reaches, and inside the
    // lines those reach in turn.
    const lines = reach(base, edit)
    let last = first
    for (let next = side[last + 1]; next && next.from < lines.to; next = side[last + 1]) {
      last += 1
      lines.to = Math.max(lines.to, reach(base, next).to)
    }
    const mine = side.slice(first, last + 1)
    let at = lines.from
    let wordy = false
    for (const one of mine) {
      if (WORDY.test(base.slice(at, one.from))) wordy = true
      at = Math.max(at, one.to)
    }
    if (WORDY.test(base.slice(at, lines.to))) wordy = true
    for (const [offset, one] of mine.entries())
      out[first + offset] = !wordy && !wholeLines(base, one)
    first = last + 1
  }
  return out
}

/** Whether an insertion at an edge of the other side's replacement, written beside
 *  it, runs a word of its own into a word the other side's text ends or starts with
 *  there: one side took out the space between two words and the other typed a word
 *  against it (`task x` and `task`, merged `taskx`); or two replacements that meet
 *  end to end with no space at the seam. */
function glued(base: string, one: Edit, other: Edit): boolean {
  if (!isInsertion(one) && !isInsertion(other)) {
    // Two replacements end to end make one stretch of the merge, and where neither
    // leaves a space at the seam they make one token neither side wrote (`[x😀`).
    const [first, then] = one.to === other.from ? [one, other] : [other, one]
    if (first.to !== then.from) return false
    const left = first.insert ? first.insert.slice(-1) : base.charAt(first.from - 1)
    const right = then.insert ? then.insert.charAt(0) : base.charAt(then.to)
    return /\S/.test(left) && /\S/.test(right)
  }
  const [insertion, span] = isInsertion(one) ? [one, other] : [other, one]
  if (!isInsertion(insertion) || isInsertion(span)) return false
  const word = (char: string) => /^[\p{L}\p{N}]/u.test(char)
  if (insertion.from === span.to) {
    const left = span.insert ? span.insert.slice(-1) : base.charAt(span.from - 1)
    return word(left) && word(insertion.insert.charAt(0))
  }
  if (insertion.from === span.from) {
    const right = span.insert ? span.insert.charAt(0) : base.charAt(span.to)
    return word(insertion.insert.slice(-1)) && word(right)
  }
  return false
}

/** Whether two sides' edits are written into one line in a way that keeping both
 *  would make a line neither side wrote: whole lines taken out or put in where the
 *  other side wrote inside one of those lines; a line one side rewrote, or the two
 *  together left no word of, and the other wrote in; two sides' words put in where
 *  one line's words begin; or an edit that breaks a line or joins it to the next,
 *  touching the other side's. Other edits inside one line are words beside words,
 *  and are both kept (`meets`), and two sides' whole lines meet only as `meets` says.
 *
 *  `edits` reads lines as lines first, so a line added or taken out is whole lines
 *  and only a line rewritten is read inside; without this, a line rewritten on one
 *  side and one written in on the other would still be read as words beside words
 *  and run together. */
function sameLine(
  base: string,
  one: Edit,
  other: Edit,
  lines: { rewritten: readonly [boolean, boolean]; bare: (span: Span) => boolean },
): boolean {
  const oneWhole = wholeLines(base, one)
  const otherWhole = wholeLines(base, other)
  if (oneWhole && otherWhole) return false
  const a = reach(base, one)
  const b = reach(base, other)
  const reached = (): boolean => {
    if (a.from === a.to) return b.from < a.from && a.from < b.to
    if (b.from === b.to) return a.from < b.from && b.from < a.to
    return a.from < b.to && b.from < a.to
  }
  if (oneWhole || otherWhole) return reached()
  if (glued(base, one, other)) return true
  if (lines.rewritten[0] || lines.rewritten[1]) return reached()
  // Between them the two sides took every word out of the line.
  if (reached() && lines.bare({ from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) })) {
    return true
  }
  // Two sides' words put in where a line's words begin each start the line their own
  // way. Further along a line they are words added beside words, as at its end.
  if (isInsertion(one) && isInsertion(other) && one.from === other.from) {
    return !WORDY.test(base.slice(a.from, one.from))
  }
  if (breaks(base, one) || breaks(base, other)) {
    // Touching, or with nothing but spaces and marks between them: no word of the
    // ancestor stands between the two to say whose line the other's words are on.
    if (one.from <= other.to && other.from <= one.to) return true
    const between =
      one.to <= other.from ? base.slice(one.to, other.from) : base.slice(other.to, one.from)
    return reached() && !WORDY.test(between)
  }
  return false
}

/** The edits both sides made alike, and what is left of each side without them.
 *  Both lists are in order and no two edits of one side touch, so one walk finds
 *  every pair. */
function paired(mine: readonly Edit[], theirs: readonly Edit[]) {
  const identical: Edit[] = []
  const local: Edit[] = []
  const remote: Edit[] = []
  let one = 0
  let other = 0

  while (one < mine.length || other < theirs.length) {
    const left = mine[one]
    const right = theirs[other]

    if (left && right && sameEdit(left, right)) {
      identical.push(left)
      one++
      other++
    } else if (
      left &&
      (!right || left.from < right.from || (left.from === right.from && left.to <= right.to))
    ) {
      local.push(left)
      one++
    } else if (right) {
      remote.push(right)
      other++
    }
  }

  return { identical, local, remote }
}

/** The edits that meet, grouped: a union of every local edit with every remote edit
 *  it overlaps. Both lists are in order, so the remote edits a local one could meet
 *  are a window that only ever moves forward. */
function grouped(base: string, local: readonly Edit[], remote: readonly Edit[]): Meeting[] {
  const parent = new Map<number, number>()
  // Local edits are 0..n-1, remote ones n..n+m-1, in one forest.
  const root = (at: number): number => {
    let node = at
    while (parent.get(node) !== undefined && parent.get(node) !== node) {
      node = parent.get(node) ?? node
    }
    return node
  }
  const join = (one: number, other: number) => {
    const a = root(one)
    const b = root(other)
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b))
  }

  // Each edit's reach holds its own span, so two edits whose reaches stay apart
  // cannot meet either way. Reaches start in order along a side, but need not end in
  // order, so a remote edit is passed over only once every one before it ends first.
  const reaches = remote.map((edit) => reach(base, edit))
  const mineRewritten = rewrittenLines(base, local)
  const theirsRewritten = rewrittenLines(base, remote)
  const reachedBy: number[] = []
  for (const span of reaches) reachedBy.push(Math.max(reachedBy.at(-1) ?? 0, span.to))

  // What the two sides took out between them, joined, and whether a stretch of the
  // ancestor keeps any word outside it, asked once per stretch.
  const taken: Span[] = []
  for (const edit of [...local, ...remote].sort((a, b) => a.from - b.from)) {
    if (edit.from === edit.to) continue
    const last = taken.at(-1)
    if (last && last.to >= edit.from) last.to = Math.max(last.to, edit.to)
    else taken.push({ from: edit.from, to: edit.to })
  }
  const asked = new Map<string, boolean>()
  const bare = (span: Span): boolean => {
    const key = `${span.from}:${span.to}`
    const known = asked.get(key)
    if (known !== undefined) return known
    let at = span.from
    let words = false
    for (const one of taken) {
      if (one.to <= at) continue
      if (one.from >= span.to) break
      if (WORDY.test(base.slice(at, one.from))) words = true
      at = Math.max(at, one.to)
      if (words || at >= span.to) break
    }
    if (!words && at < span.to && WORDY.test(base.slice(at, span.to))) words = true
    asked.set(key, !words)
    return !words
  }

  const touched = new Set<number>()
  let window = 0
  for (const [index, edit] of local.entries()) {
    const mine = reach(base, edit)
    while (window < remote.length && (reachedBy[window] ?? 0) < mine.from) window++

    for (let at = window; at < remote.length; at++) {
      const other = remote[at]
      const theirs = reaches[at]
      if (!other || !theirs || theirs.from > mine.to) break
      const rewritten = [!!mineRewritten[index], !!theirsRewritten[at]] as const
      if (!meets(edit, other) && !sameLine(base, edit, other, { rewritten, bare })) continue

      touched.add(index)
      touched.add(local.length + at)
      join(index, local.length + at)
    }
  }

  const groups = new Map<number, { local: Edit[]; remote: Edit[] }>()
  for (const node of [...touched].sort((a, b) => a - b)) {
    const key = root(node)
    const group = groups.get(key) ?? { local: [], remote: [] }
    groups.set(key, group)

    const isLocal = node < local.length
    const edit = isLocal ? local[node] : remote[node - local.length]
    if (edit) (isLocal ? group.local : group.remote).push(edit)
  }

  const meetings: Meeting[] = []
  for (const group of groups.values()) {
    const all = [...group.local, ...group.remote]
    const from = Math.min(...all.map((edit) => edit.from))
    const to = Math.max(...all.map((edit) => edit.to))
    const written = all.reduce((sum, edit) => sum + edit.insert.length, 0)

    meetings.push({ base: { from, to }, ...group, size: written + (to - from) })
  }

  return meetings.sort((a, b) => a.base.from - b.base.from)
}

/** Where two sides wrote: each side's edits, the ones they share, the meetings, and
 *  what meets nothing. */
export function analyse(base: string, local: string, remote: string): Analysis {
  const mine = edits(base, local, 'semantic')
  const theirs = edits(base, remote, 'semantic')
  const { identical, local: onlyMine, remote: onlyTheirs } = paired(mine, theirs)
  const meetings = grouped(base, onlyMine, onlyTheirs)

  const met = new Set<Edit>(meetings.flatMap((meeting) => [...meeting.local, ...meeting.remote]))
  return {
    local: mine,
    remote: theirs,
    identical,
    meetings,
    alone: {
      local: onlyMine.filter((edit) => !met.has(edit)),
      remote: onlyTheirs.filter((edit) => !met.has(edit)),
    },
  }
}

/** One replacement to write into the ancestor, and where it goes among others that
 *  land on the same point: insertions before replacements, and between insertions,
 *  whichever side goes first. */
interface Piece extends Edit {
  rank: number
}

/** A meeting as a CRDT leaves it: every character either side deleted gone, every
 *  insertion kept where it was made, and insertions at one point in `first`'s order. */
function both(base: string, meeting: Meeting, first: Whose): string {
  const { from, to } = meeting.base
  const gone = new Uint8Array(to - from)
  const inserts = new Map<number, string[]>()

  const sides: [Whose, readonly Edit[]][] = [
    ['local', meeting.local],
    ['remote', meeting.remote],
  ]
  if (first === 'remote') sides.reverse()

  for (const [, list] of sides) {
    for (const edit of list) {
      gone.fill(1, edit.from - from, edit.to - from)
      if (!edit.insert) continue
      const here = inserts.get(edit.from) ?? []
      here.push(edit.insert)
      inserts.set(edit.from, here)
    }
  }

  // Each point's insertions go before the ancestor character there, and the walk ends
  // at `to` itself: an insertion at the very end of the passage has no character after
  // it to go before, and a meeting of insertions at one point covers no ancestor at
  // all, so `to` is the only place its words are.
  let out = ''
  for (let at = from; at <= to; at++) {
    out += (inserts.get(at) ?? []).join('')
    if (at < to && !gone[at - from]) out += base.charAt(at)
  }
  return out
}

/** How the merge is written: each meeting settled by `settle`, identical edits once,
 *  and where both sides put words at one point, `first` says whose go ahead (local,
 *  unless it says otherwise for that point). */
export interface Writing {
  settle: (meeting: Meeting) => Settle
  first?: (at: number) => Whose
}

/** The points where both sides' words land at one place, so their order is a choice:
 *  what `first` in `Writing` is asked about. */
export function sharedPoints(analysis: Analysis): number[] {
  const side = (whose: Whose) => [
    ...analysis.alone[whose],
    ...analysis.meetings.flatMap((meeting) => meeting[whose]),
  ]
  const mine = new Set(side('local').map((edit) => edit.from))
  const points = new Set<number>()
  for (const edit of side('remote')) if (mine.has(edit.from)) points.add(edit.from)
  return [...points].sort((a, b) => a - b)
}

/** The ancestor with the edits written in, as `writing` says. */
export function written(base: string, analysis: Analysis, writing: Writing): string {
  const first = writing.first ?? (() => 'local')
  const rankOf = (whose: Whose, at: number) => (whose === first(at) ? 0 : 1)
  const pieces: Piece[] = []

  for (const edit of analysis.alone.local)
    pieces.push({ ...edit, rank: rankOf('local', edit.from) })
  for (const edit of analysis.alone.remote)
    pieces.push({ ...edit, rank: rankOf('remote', edit.from) })
  for (const edit of analysis.identical) pieces.push({ ...edit, rank: 0 })

  for (const meeting of analysis.meetings) {
    const settled = writing.settle(meeting)
    if (settled === 'both') {
      const insert = both(base, meeting, first(meeting.base.from))
      pieces.push({ ...meeting.base, insert, rank: 0 })
      continue
    }
    for (const edit of meeting[settled]) pieces.push({ ...edit, rank: rankOf(settled, edit.from) })
  }

  // In order along the ancestor; at one point, whoever goes first. Whole lines go
  // ahead of words written into the line they land on, whoever goes first, since
  // after it they would run into that line. And an insertion goes ahead of a
  // replacement that starts where it was made: it was put in before the text the
  // replacement takes out, so it goes before the words that stand for that text, and
  // after them it would run into their last word (`breadfresh`).
  const inside = (piece: Piece) => (wholeLines(base, piece) ? 0 : 1)
  const replaces = (piece: Piece) => (piece.to > piece.from ? 1 : 0)
  pieces.sort(
    (a, b) =>
      a.from - b.from ||
      inside(a) - inside(b) ||
      replaces(a) - replaces(b) ||
      a.rank - b.rank ||
      a.to - b.to,
  )

  let out = ''
  let at = 0
  for (const piece of pieces) {
    out += base.slice(at, piece.from) + piece.insert
    at = Math.max(at, piece.to)
  }

  return out + base.slice(at)
}

/** The three-way merge of `local` and `remote` against `base`, with the map of where
 *  they wrote. Each meeting is settled by `settle`: by default as a CRDT would leave
 *  it, which loses nothing either side wrote. */
export function merge3(
  base: string,
  local: string,
  remote: string,
  settle: (meeting: Meeting) => Settle = () => 'both',
): Merged {
  const analysis = analyse(base, local, remote)
  return {
    ...analysis,
    text: written(base, analysis, { settle }),
  }
}
