/** Keeping the place when a note changes its skin.
 *
 *  The editor knows where it is as a position in the document: the line at the
 *  top of what is on screen, which is what a tab remembers and what `showLine`
 *  puts back. The reading view knows where it is as pixels down a page. This is
 *  the arithmetic between the two, and it is arithmetic on plain numbers so that
 *  both directions can be tested without a browser.
 *
 *  Both directions go through the same anchors: the headings, which are the one
 *  thing the two faces of a note certainly agree on. Between two anchors the
 *  place is a fraction of the way from one to the next - by characters in the
 *  source, by pixels on the page - so the paragraph at the top stays the
 *  paragraph at the top. A note with no headings is one long anchor from its
 *  first character to its last, which is as close as a guess can get. */

/** One place both faces know: how far into the source it is, and how far down the
 *  page. In order, and rising in both. */
export interface Anchor {
  position: number
  top: number
}

/** Where to scroll so that the source at `position` is at the top of the page. */
export function topFor(position: number, anchors: readonly Anchor[]): number {
  return along(
    position,
    anchors,
    (anchor) => anchor.position,
    (anchor) => anchor.top,
  )
}

/** Which place in the source is at the top when the page is scrolled to `top`. */
export function positionAt(top: number, anchors: readonly Anchor[]): number {
  return Math.round(
    along(
      top,
      anchors,
      (anchor) => anchor.top,
      (anchor) => anchor.position,
    ),
  )
}

/** The same interpolation both ways round: which pair of anchors `value` falls
 *  between when read one way, and how far between them that is when written the
 *  other. Beyond either end it is the end, since there is nothing to interpolate
 *  towards. */
function along(
  value: number,
  anchors: readonly Anchor[],
  read: (anchor: Anchor) => number,
  write: (anchor: Anchor) => number,
): number {
  let at = 0
  while (at + 1 < anchors.length) {
    const next = anchors[at + 1]
    if (!next || read(next) > value) break
    at++
  }

  const one = anchors[at]
  if (!one) return 0

  const next = anchors[at + 1]
  if (!next) return write(one)

  const span = read(next) - read(one)
  const fraction = span > 0 ? Math.min(1, Math.max(0, (value - read(one)) / span)) : 0

  return write(one) + fraction * (write(next) - write(one))
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
