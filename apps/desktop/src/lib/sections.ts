/** Moving a whole section of a note, which is what dragging a row of the outline
 *  does.
 *
 *  A section is a heading and everything under it up to the next heading of the
 *  same level or shallower: what a reader means by "this part". Moving one is two
 *  edits and never a rewrite - the words are cut from where they were and put in
 *  where they land - so a note open in another pane takes it as the change it is
 *  and every caret in the rest of the note stays where its reader left it.
 *
 *  Here as plain functions over the text, beside `scanHeadings`, for the same
 *  reason that one is: it can be tested without a document, and the arithmetic
 *  that decides what moves lives in one place rather than in a component.
 *
 *  Nothing here re-levels anything. Dragging a `###` above a `#` leaves it a
 *  `###`, because a drag is a move and rewriting the hashes would be answering a
 *  question nobody asked; the outline draws its steps from the shallowest heading
 *  the note has, so it still reads. The one thing that is refused is a section
 *  dropped inside itself, which is not a move at all. */

import type { Heading } from './outline'

/** Where a line begins, counting lines from zero. Past the last line, the end of
 *  the text: a section that runs to the bottom ends there. */
function offsetOf(text: string, line: number): number {
  if (line <= 0) return 0

  let at = 0
  for (let count = 0; count < line; count++) {
    const end = text.indexOf('\n', at)
    if (end === -1) return text.length
    at = end + 1
  }

  return at
}

/** The span of one section: from the start of its heading's line to the start of
 *  the next heading at its own level or shallower, or the end of the note. */
export function sectionSpan(
  text: string,
  headings: readonly Heading[],
  at: number,
): { from: number; to: number } | null {
  const heading = headings[at]
  if (!heading) return null

  const next = headings.findIndex((one, index) => index > at && one.level <= heading.level)

  return {
    from: offsetOf(text, heading.line),
    to: next === -1 ? text.length : offsetOf(text, headings[next]?.line ?? 0),
  }
}

/** Which sections a section covers: itself and every heading under it. Dropping
 *  one of these on it would be dropping it inside itself. */
function covers(headings: readonly Heading[], at: number): (index: number) => boolean {
  const heading = headings[at]
  if (!heading) return () => false

  const next = headings.findIndex((one, index) => index > at && one.level <= heading.level)
  const last = next === -1 ? headings.length : next

  return (index) => index >= at && index < last
}

/** Whether dragging the section at `from` onto the one at `to` would move
 *  anything at all. */
export function movesSection(headings: readonly Heading[], from: number, to: number): boolean {
  if (from === to) return false
  if (!headings[from] || !headings[to]) return false

  return !covers(headings, from)(to)
}

/** One move, as the edits that make it and where the caret ends up.
 *
 *  `caret` is where the caret was; the answer is where the same character is
 *  afterwards. A caret inside the section travels with it, which is what makes a
 *  drag of the part you are writing in feel like moving the part rather than
 *  being thrown out of it. A caret anywhere else is left to the change set,
 *  which maps it correctly on its own.
 *
 *  Null when the move would do nothing, or would put a section inside itself. */
export function moveSection(
  text: string,
  headings: readonly Heading[],
  from: number,
  to: number,
  caret = 0,
): { changes: { from: number; to: number; insert: string }[]; caret: number } | null {
  if (!movesSection(headings, from, to)) return null

  const moving = sectionSpan(text, headings, from)
  const target = sectionSpan(text, headings, to)
  if (!moving || !target) return null

  const body = text.slice(moving.from, moving.to)
  // Down the list, the section lands after the one it was dropped on; up the
  // list, in front of it. That is what the line drawn on the near edge of the
  // target row says, and it is what moving a row of a list means.
  const landing = to > from ? target.to : target.from

  // A section that does not end in a break would run into whatever follows it.
  const insert = body.endsWith('\n') ? body : `${body}\n`

  const changes = [
    { from: moving.from, to: moving.to, insert: '' },
    { from: landing, to: landing, insert },
  ]

  // Where the words are once both edits have landed. Moving down, the cut is
  // above the landing and takes its own length out of the offset; moving up, the
  // landing is above the cut and nothing before it has changed.
  const arrivedAt = to > from ? landing - (moving.to - moving.from) : landing
  const inside = caret >= moving.from && caret <= moving.to

  return { changes, caret: inside ? arrivedAt + (caret - moving.from) : caret }
}
