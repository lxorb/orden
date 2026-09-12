/** Where a fenced code block opens and closes.
 *
 *  Four things in this package walk a note line by line and have to step over
 *  code: the comment stripper, the abbreviation collector, the deck's break
 *  scanner and the link scanner. Each carried its own pattern and its own idea of
 *  what closes a fence, and they did not agree - so a note whose fences were
 *  written in a way one of them misread had its comments stripped inside code, or
 *  taught itself an abbreviation it was only showing. One reading, here.
 *
 *  Not markdown's whole grammar for a fence: a fence inside a blockquote or a
 *  list item carries a prefix, which none of the four walks unwraps. What this
 *  answers is the question they all actually ask - does this line open or close a
 *  block of code - and it answers it the same way for all of them. */

/** Up to three spaces of indent, as CommonMark allows before an indented code
 *  block takes over; then the run of marks; then the info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/

/** Whether a line could be a fence at all: a mark, after up to three spaces.
 *
 *  A byte or two instead of the pattern. Every walk below is asked about every
 *  line of the note - on every render, and in the editor on every keystroke -
 *  and nearly every line it is asked about is prose. */
function couldBeFence(line: string): boolean {
  let at = 0
  while (at < 3 && line[at] === ' ') at++

  const mark = line[at]
  return mark === '`' || mark === '~'
}

/** The run of backticks or tildes a fence line carries, or null for a line that
 *  is not a fence at all. The run itself, because how long it is and which
 *  character it is made of are both what closes it. */
export function fenceMark(line: string): string | null {
  if (!couldBeFence(line)) return null
  return FENCE.exec(line)?.[1] ?? null
}

/** Whether a line closes the fence `mark` opened: the same character, at least as
 *  many of them, and nothing after them.
 *
 *  The last of the three is the one that is easy to forget. CommonMark allows an
 *  info string only on the line that opens a block, so ```` ```ts ```` inside a
 *  block is code being shown rather than the end of the block showing it. */
export function closesFence(line: string, mark: string): boolean {
  if (!couldBeFence(line)) return false

  const found = FENCE.exec(line)
  const run = found?.[1]
  if (!run || !found) return false

  return run[0] === mark[0] && run.length >= mark.length && !found[2]
}
