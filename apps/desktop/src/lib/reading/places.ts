/** Keeping the place when a note changes its skin.
 *
 *  The editor knows where it is as a position in the document: the line at the
 *  top of what is on screen, which is what a tab remembers and what `showLine`
 *  puts back. The reading view knows where it is as pixels down a page. This is
 *  the arithmetic between the two, and it is arithmetic on plain numbers so that
 *  both directions can be tested without a browser.
 *
 *  Both directions go through the same anchors: the headings, which are the one
 *  thing the two faces of a note certainly agree on. Between two headings the
 *  place is a fraction of the way from one to the next, and a note with no headings
 *  is one long section from its first character to its last, which is as close as a
 *  guess can get.
 *
 *  What is *not* here any more is the page's side of it. This used to hold both
 *  halves - a position turned into a pixel and back - and the page's half stopped
 *  being arithmetic when the reading view stopped laying out the blocks nobody can
 *  see: a pixel measured over a thousand blocks that have an estimated height is a
 *  pixel measured over estimates. So the page's half is a `scrollIntoView` on the
 *  heading itself, in Reading.svelte, where the elements are. */

/** A place in the note as the two faces both understand it: which heading it is
 *  under, and how far from that heading to the next.
 *
 *  Which heading rather than how many pixels, because the page no longer lays out
 *  the blocks nobody can see - see the `content-visibility` rule in Reading.svelte -
 *  and a block that has not been laid out has an estimated height rather than a
 *  real one. Pixels measured over a thousand estimates land nowhere near: the same
 *  heading that used to be reached exactly was fifty-seven thousand pixels out. An
 *  element, on the other hand, can be asked to bring itself into view, and the
 *  browser renders whatever it must to do it exactly.
 *
 *  So the pixels live in the page and only the arithmetic lives here, which is
 *  still the half worth testing without a browser. */
export interface Section {
  /** Which heading, counting from zero. -1 for a place above the first one. */
  index: number
  /** How far from that heading to the next, from 0 to 1. */
  fraction: number
}

/** Which heading a position sits under, and how far through it.
 *
 *  `offsets` is `headingOffsets`, which rises, and `end` is the length of the note,
 *  which is where the last section stops. A position before the first heading is
 *  section -1, and a note with no headings at all is one section from its first
 *  character to its last - which is as close as a guess can get, and the same guess
 *  the anchors used to make. */
export function sectionAt(position: number, offsets: readonly number[], end: number): Section {
  let index = -1
  for (let one = 0; one < offsets.length; one++) {
    const at = offsets[one]
    if (at === undefined || at > position) break
    index = one
  }

  const from = index < 0 ? 0 : (offsets[index] ?? 0)
  const next = offsets[index + 1] ?? end
  const span = next - from
  const fraction = span > 0 ? Math.min(1, Math.max(0, (position - from) / span)) : 0

  return { index, fraction }
}

/** And back: where in the source a section and a fraction of it fall. The inverse
 *  of `sectionAt`, so a place that goes one way and comes back is the place it
 *  started at - which is what makes switching between the two faces of a note and
 *  back again land where it began. */
export function positionOf(section: Section, offsets: readonly number[], end: number): number {
  const { index, fraction } = section
  const from = index < 0 ? 0 : (offsets[index] ?? 0)
  const next = offsets[index + 1] ?? end

  return Math.round(from + Math.min(1, Math.max(0, fraction)) * Math.max(0, next - from))
}

/** Just past a note's front matter, or the start of the note when it has none. */
function frontMatterEnd(text: string): number {
  if (!text.startsWith('---')) return 0

  const closing = /^---[ \t]*$/m.exec(text.slice(4))
  return closing ? 4 + closing.index + closing[0].length : 0
}

/** A heading line, its hashes, and the underline the other spelling uses. Up to
 *  three spaces of indent, which is what still counts as a heading rather than as
 *  code, and what the renderer reads too. */
const ATX = /^ {0,3}#{1,6}(?:\s|$)/
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
const FENCE = /^\s{0,3}(?:```|~~~)/
/** A line that opens something other than a paragraph, and so cannot be the words
 *  of an underlined heading: a list, a quote, a table row, indented code. */
const NOT_PROSE = /^(?: {4}|\t|[ \t]*(?:[-*+>|]|\d+[.)])(?:\s|$))/

/** Where each heading of a note begins, in order.
 *
 *  What the anchors are made of on the source's side, so this has to see exactly
 *  the headings the renderer gives an id to and no others: both spellings, none
 *  inside a fence, none indented into code. Where it disagrees, the caller counts
 *  the headings on the page, finds a different number and falls back to the ends
 *  of the note rather than lining the wrong ones up. */
export function headingOffsets(text: string): number[] {
  const found: number[] = []
  let fenced = false
  // Front matter is metadata and never reaches the page, so nothing in it is a
  // heading - and its closing `---` would otherwise read as one, underlining the
  // last field. Stepped over rather than cut off, because these offsets are into
  // the whole note, which is what the editor counts in.
  let at = frontMatterEnd(text)
  /** Where the line above began, when it could be a heading's words. */
  let prose: number | null = null

  for (;;) {
    const end = text.indexOf('\n', at)
    const line = text.slice(at, end === -1 ? text.length : end)

    if (FENCE.test(line)) {
      fenced = !fenced
      prose = null
    } else if (fenced) {
      prose = null
    } else if (ATX.test(line)) {
      found.push(at)
      prose = null
    } else if (prose !== null && UNDERLINE.test(line)) {
      found.push(prose)
      prose = null
    } else {
      prose = line.trim() === '' || NOT_PROSE.test(line) ? null : at
    }

    if (end === -1) return found
    at = end + 1
  }
}
