/** What a reader chose about text mode, as data: which of a note's own markers are
 *  drawn, and how much of its white space reaches the panel.
 *
 *  Its own module, and its own subpath, because the app's settings need these five
 *  values and nothing else about the glasses. Read off `mark.ts` they came with the
 *  whole text engine behind them - the firmware metrics in
 *  `@evenrealities/pretext`, six hundred kilobytes of them, plus the emoji table
 *  `insteadOf` uses and the markdown lexer the mapping walks - and the settings
 *  panel is on screen at the first paint, so all of that was in front of it. None
 *  of it is needed to know that `collapse` is a word somebody may have stored.
 *
 *  `mark.ts` re-exports every name here, so the package's own entry point and
 *  everything that draws a panel are unchanged; see index.ts. */

/** Which of a note's own markers are drawn on the glasses.
 *
 *  Rule one in mark.ts says which are worth drawing, and the defaults are that
 *  rule. This is the reader overruling it, per construct: somebody proof-reading
 *  their own markdown wants to see the asterisks, and somebody reading a note does
 *  not. A switch each rather than one "show markdown" switch, because the answer is
 *  different for a fence and for a bold word and that difference is the rule. */
export interface Marks {
  /** The `#` in front of a heading. Off: the capitals say what it is. */
  heading: boolean
  bold: boolean
  italic: boolean
  strike: boolean
  highlight: boolean
  /** The backticks around inline code. On: whether something is code changes
   *  what it means. */
  code: boolean
  /** The ``` lines around a fence. On, for the same reason. */
  fence: boolean
  /** The brackets and the address of a link. Off: the words it shows are what
   *  there is to read. */
  link: boolean
}

/** What a note shows with nobody having said otherwise: code marked, style marks
 *  dropped, headings without their hashes. Emil's rule, as a value. */
export const MARKS: Marks = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: true,
  fence: true,
  link: false,
}

/** How much of a note's own white space reaches the panel.
 *
 *  Seven lines is not many, and how they are spent is a real choice rather than a
 *  detail. Emil's three, in his words:
 *
 *  - `none` shows every line break as written, even ten in a row;
 *  - `collapse` folds runs of blank lines into one break, so A, blank, blank, B
 *    shows A then B on the next line, while A, newline, B keeps two lines;
 *  - `aggressive` joins A, newline, B into one line, and only two or more
 *    newlines start a new line.
 *
 *  Whatever the level, **a line number is the line of the file**. That is the
 *  point of the numbers: a row that says 12 is line 12 of the note, whether ten
 *  lines were folded into it or none were. */
export type Compaction = 'none' | 'collapse' | 'aggressive'

export const COMPACTIONS: readonly Compaction[] = ['none', 'collapse', 'aggressive']

/** What a reader who has never chosen gets: `collapse`, which is Emil's answer
 *  having read on a pair.
 *
 *  It was `aggressive`, which is what the plugin did before there was a choice at
 *  all. Said once, here, and read by the mapping, by the schema's own initial and by
 *  the store's default, so the three cannot drift; a device that has already saved a
 *  value keeps whatever it saved. */
export const DEFAULT_COMPACTION: Compaction = 'collapse'

export function isCompaction(value: unknown): value is Compaction {
  return typeof value === 'string' && (COMPACTIONS as readonly string[]).includes(value)
}
