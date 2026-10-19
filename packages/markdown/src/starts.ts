/** Where a block construct could begin, found without reading the rest of the
 *  document for every paragraph in it.
 *
 *  Every block extension hands marked a `start`: the earliest place its construct
 *  could begin in what is left of the document. Marked asks all of them again for
 *  every paragraph it meets, and it hands each of them the whole tail, so a
 *  `start` that reads what it is given costs the render a pass per paragraph.
 *  That is quadratic: on a 500 KB note it was 400 of the 900 ms a render took,
 *  and it grew faster than the note did.
 *
 *  Two things bring it back to one pass. The tail is only read as far as the
 *  paragraph marked is about to make of it, which is all a `start` can change:
 *  marked uses the answer to cut that paragraph short, and a paragraph ends at
 *  the next blank line whatever is written after it. Anything further along is
 *  met by the tokenizer at the next block anyway. And within that window the
 *  construct is looked for as the literals it must contain, which is a byte scan
 *  rather than a regular expression, with the pattern confirming the few
 *  characters around each place they turn up. */

import { type MarkedExtension, Tokenizer } from 'marked'

/** Just past the blank line that ends the paragraph about to be read, or the end
 *  of what is left when there is none. A `start` past this cannot matter. */
export function paragraphWindow(src: string): number {
  for (let at = 0; ;) {
    const end = src.indexOf('\n', at)
    if (end === -1) return src.length

    // A line of nothing but blanks ends the paragraph as an empty one does.
    let next = end + 1
    while (next < src.length && (src[next] === ' ' || src[next] === '\t')) next++

    if (next >= src.length) return src.length
    if (src[next] === '\n' || src[next] === '\r') return next + 1

    at = next
  }
}

/** The first place any of `needles` appears that `place` accepts, as the index
 *  `place` answers with: a construct that has to begin a line starts at the
 *  newline before it, which is where the pattern this replaces matched from.
 *
 *  The needles are looked for in the paragraph only; each candidate is then given
 *  to `place` against the whole of `src`, because a construct that begins inside
 *  the paragraph may well run past it - a `$$` block does.
 *
 *  Undefined when there is none, which marked reads as "not in what is left". */
export function firstStart(
  src: string,
  needles: readonly string[],
  place: (src: string, at: number) => number | null,
): number | undefined {
  const end = paragraphWindow(src)
  const window = end >= src.length ? src : src.slice(0, end)
  let found: number | undefined

  for (const needle of needles) {
    for (let at = window.indexOf(needle); at !== -1; at = window.indexOf(needle, at + 1)) {
      const start = place(src, at)
      if (start === null) continue

      // Each needle is scanned on its own, so the earliest of their answers is
      // the one a single pattern would have come back with.
      if (found === undefined || start < found) found = start
      break
    }
  }

  return found
}

/** The newline that begins the line `at` sits on, when nothing but up to `blanks`
 *  blanks comes between the two. Null when something else does.
 *
 *  `orString` for a pattern that matched from `^` as well as from a newline: then
 *  the start of the string is a line start too, and is answered with 0, which is
 *  where such a pattern reported it. */
export function lineStart(
  src: string,
  at: number,
  options: { blanks?: number; orString?: boolean } = {},
): number | null {
  const blanks = options.blanks ?? 0

  let start = at
  while (start > 0 && at - start < blanks && isBlank(src[start - 1])) start--

  if (start === 0) return options.orString === true ? 0 : null
  return src[start - 1] === '\n' ? start - 1 : null
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

/** Whether `pattern` matches at exactly `at`. The pattern has to be sticky, and
 *  is left with its `lastIndex` wherever this put it: nothing else reads it. */
export function matchesAt(pattern: RegExp, src: string, at: number): boolean {
  pattern.lastIndex = at
  return pattern.test(src)
}

/** Emphasis that cannot close, turned away before marked looks for it to.
 *
 *  Here rather than in a module of its own because the deck's lexer needs it
 *  too, and the deck reader loads this already and nothing more of the package
 *  than it has to.
 *
 *  Marked reads `*` and `_` by taking each run that could open and walking the
 *  rest of the paragraph for the run that closes it. A run that nothing closes is
 *  walked to the very end, so a paragraph of them is quadratic: `*a ` a hundred
 *  thousand characters long took 162 seconds, in marked 18.1.1 as in 18.0.11
 *  (#547).
 *
 *  The walk is a running count. It starts at the opener's length; a run that can
 *  only open adds its length, one that can close takes its length away, one that
 *  can do both takes it away unless CommonMark's rule of three makes it neither,
 *  and the opener closes once the count is down to nothing. Every run and what
 *  it counts as depends only on the characters either side of it, so the counts
 *  for the whole paragraph are summed once, and a running minimum from the end
 *  says for each opener whether the count ever gets there. If it cannot, marked
 *  would walk to the end and find nothing, and the answer is given without the
 *  walk. If it can, marked walks as it always has, and finds the closer where
 *  this says it is.
 *
 *  Read off marked's own `emStrongRDelimAst` and `emStrongRDelimUnd`, over the
 *  same masked text it walks, in which escapes, code spans and links are already
 *  out of the way. */

/** Which side of a run a character puts it on: blank, punctuation, or a word. */
const BLANK = 0
const MARK = 1
const WORD = 2
const NONE = 3

const BLANKS = /\s/u
const MARKS = /[\p{P}\p{S}]/u

/** What the character at `code` is to a run of `mark`. `~` is a word to `*`, which
 *  is how marked spells it, and punctuation to `_`. */
function sideOf(code: number | undefined, mark: string): number {
  if (code === undefined) return NONE
  const character = String.fromCodePoint(code)
  if (BLANKS.test(character)) return BLANK
  if (character === '~' && mark === '*') return WORD
  return MARKS.test(character) ? MARK : WORD
}

/** The runs of one mark in a paragraph, and for each remainder of an opener's
 *  length modulo three, the counts summed: `sums[m][k]` is the count after the
 *  first `k` runs, and `lowest[m][k]` the lowest it gets at or after `k`. */
interface Runs {
  starts: number[]
  sums: Int32Array[]
  lowest: Int32Array[]
}

/** Opens only, closes only, both, or neither, from the characters either side. */
function roleOf(before: number, after: number, mark: string): 'open' | 'close' | 'both' | null {
  if (before === BLANK) return after === BLANK || after === NONE ? null : 'open'
  if (before === MARK) {
    if (after === BLANK || after === NONE) return 'close'
    return after === WORD ? 'open' : 'both'
  }
  // A word before: `a*b` is both to `*` and nothing to `_`, which never opens or
  // closes inside a word.
  if (after === WORD) return mark === '*' ? 'both' : null
  return 'close'
}

function runsOf(masked: string, mark: string): Runs {
  const starts: number[] = []
  const lengths: number[] = []
  const roles: ('open' | 'close' | 'both' | null)[] = []

  for (let at = masked.indexOf(mark); at !== -1;) {
    let end = at
    while (masked[end] === mark) end++

    // The character before, whole: the low half of a pair is not one.
    const unit = masked.charCodeAt(at - 1)
    const back = at >= 2 && unit >= 0xdc00 && unit <= 0xdfff ? at - 2 : at - 1
    const before = at === 0 ? undefined : masked.codePointAt(back)
    starts.push(at)
    lengths.push(end - at)
    roles.push(
      at === 0 ? null : roleOf(sideOf(before, mark), sideOf(masked.codePointAt(end), mark), mark),
    )

    at = masked.indexOf(mark, end)
  }

  const sums: Int32Array[] = []
  const lowest: Int32Array[] = []
  for (let remainder = 0; remainder < 3; remainder++) {
    const sum = new Int32Array(starts.length + 1)
    for (let k = 0; k < starts.length; k++) {
      const length = lengths[k] ?? 0
      const role = roles[k]
      const middle = role === 'both' && remainder !== 0 && (remainder + length) % 3 === 0
      const step = role === 'open' ? length : role === null || middle ? 0 : -length
      sum[k + 1] = (sum[k] ?? 0) + step
    }

    const low = new Int32Array(starts.length + 2)
    low[starts.length + 1] = 2 ** 30
    for (let k = starts.length; k >= 0; k--) low[k] = Math.min(sum[k] ?? 0, low[k + 1] ?? 0)

    sums.push(sum)
    lowest.push(low)
  }

  return { starts, sums, lowest }
}

/** The runs of each mark in the paragraphs asked about lately, by the masked
 *  string marked hands every opener in one run of text. Several, not one: an
 *  opener's words are a run of their own, read in the middle of the run around
 *  them, and forgetting the outer one each time read it again for every opener
 *  in it - quadratic once more. A handful covers any nesting worth reading. */
const read: Record<string, Map<string, Runs>> = { '*': new Map(), _: new Map() }
const READ_MOST = 16

/** Whether the run of `mark` at `at` in `masked` could close at all. */
function couldClose(masked: string, at: number, mark: string): boolean {
  const known = read[mark] ?? new Map<string, Runs>()
  let runs = known.get(masked)
  if (!runs) {
    runs = runsOf(masked, mark)
    if (known.size >= READ_MOST) known.delete(known.keys().next().value ?? '')
    known.set(masked, runs)
  }

  let length = 0
  while (masked[at + length] === mark) length++

  // Marked's walk begins with one shape the counts do not see: `__…*…__` straight
  // after a `*` opener, and `**…_…**` after a `_` one, step over the mark inside.
  // So an opener followed by the other doubled mark before any single one is
  // left to marked, as it always was.
  const other = mark === '*' ? '__' : '**'
  let next = at + length
  while (next < masked.length && masked[next] !== '*' && masked[next] !== '_') next++
  if (masked.startsWith(other, next)) return true

  // The first run after this one.
  const { starts } = runs
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((starts[middle] ?? 0) <= at) low = middle + 1
    else high = middle
  }

  const sums = runs.sums[length % 3]
  const lowest = runs.lowest[length % 3]
  if (!sums || !lowest || low >= starts.length) return false
  return (lowest[low + 1] ?? 0) - (sums[low] ?? 0) <= -length
}

/** How deep emphasis is read inside emphasis. Marked reads the words of each in a
 *  call of its own, so `*a ` a few thousand times and `a* ` as often after them
 *  went a few thousand calls deep, read the paragraph again at every one of them,
 *  and ran out of stack - and a note that throws is a note nobody can open.
 *  Deeper than this, a mark is a character. */
const DEEPEST = 32
let depth = 0

/** Marked's own emphasis, asked only about an opener that could close. */
export const emphasis: MarkedExtension = {
  tokenizer: {
    emStrong(src, masked, before) {
      const mark = src.charAt(0)
      const at = masked.length - src.length
      if ((mark !== '*' && mark !== '_') || masked.charAt(at) !== mark) return false
      if (!couldClose(masked, at, mark) || depth >= DEEPEST) return undefined

      depth++
      try {
        return Tokenizer.prototype.emStrong.call(this, src, masked, before)
      } finally {
        depth--
      }
    },
  },
}
