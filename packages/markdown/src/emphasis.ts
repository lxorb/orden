/** Emphasis that cannot close, turned away before marked looks for it to.
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

import { type MarkedExtension, Tokenizer } from 'marked'

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
