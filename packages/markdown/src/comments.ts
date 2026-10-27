/** Notes to yourself, kept out of everything anybody else reads.
 *
 *  Two spellings, one grammar. Markdown has no comment of its own, so an HTML
 *  comment is what every editor uses for one, and Obsidian added `%%like this%%`
 *  because the HTML one is a lot of characters to type around three words. Both
 *  are file content: neither is ever rewritten, so a note written here opens the
 *  same way over there.
 *
 *  A reader is entitled to expect neither to show up. In the app they never did
 *  for the HTML one - a browser hides a real comment - but a published page
 *  escapes its HTML, because a blog shares a domain with every other blog, and
 *  the escape turned the comment into a line of prose on the page. `%%` has no
 *  such luck anywhere: it is ordinary text to every renderer alive. So both come
 *  out of the source before anything renders it, which answers the reading view,
 *  every export, the published page and the glasses in one place.
 *
 *  What it must not touch is code. A comment inside a fence, or inside
 *  backticks, is what the fence is showing - a snippet of HTML with a comment in
 *  it is a perfectly ordinary thing to write about - so this walks the source
 *  rather than running a pattern over it. Which lines are code is read by
 *  `CodeBlocks` in fences.ts, as the renderer reads it: a fence in a quote or a callout, and
 *  indented code, are code as much as a fence at the margin is. */

import { CODE, CodeBlocks, closingTicks, OPENS } from './fences'

/** The two ways a comment is written. `%%` opens and closes with the same
 *  characters, which the scan below does not care about: it looks for the
 *  opening it is not inside one, and for the closing when it is. */
const COMMENTS = [
  { open: '<!--', close: '-->' },
  { open: '%%', close: '%%' },
] as const

/** Where the first comment at or after `at` opens: the marker's own span, and
 *  what will close it. */
function opening(line: string, at: number): { from: number; to: number; close: string } | null {
  let found: { from: number; to: number; close: string } | null = null

  for (const comment of COMMENTS) {
    const from = line.indexOf(comment.open, at)
    if (from === -1 || (found && from >= found.from)) continue
    found = { from, to: from + comment.open.length, close: comment.close }
  }

  return found
}

/** The line with its comments taken out, and what is left open at the end of it:
 *  a backtick run that has not closed is not our business, but a comment that
 *  has not closed swallows the lines below. */
function stripLine(line: string, inside: string | null): { text: string; inside: string | null } {
  let out = ''
  let at = 0
  let open = inside

  while (at < line.length) {
    if (open) {
      const end = line.indexOf(open, at)
      if (end === -1) return { text: out, inside: open }
      at = end + open.length
      open = null
      continue
    }

    // A backslash makes the character after it words, so `\<!--` is how a page's
    // own `<!--` is written into a note, by a conversion or by hand, and opens
    // nothing. It is taken with the character it escapes, which also keeps an
    // escaped backtick from starting code and a doubled backslash from escaping
    // the comment after it.
    if (line[at] === '\\') {
      out += line.slice(at, at + 2)
      at += 2
      continue
    }

    // A backtick run is inline code up to the next run of the same length, and
    // whatever is between them is shown rather than read. An unclosed run is not
    // code at all, so the scan carries on past it.
    if (line[at] === '`') {
      const marks = /^`+/.exec(line.slice(at))?.[0] ?? '`'
      const close = closingTicks(line, at + marks.length, marks.length)
      const span = close === -1 ? marks.length : close + marks.length - at
      out += line.slice(at, at + span)
      at += span
      continue
    }

    const found = opening(line, at)
    if (!found) {
      out += line.slice(at)
      break
    }

    // Only up to the comment, and then round again: the backslash and backtick
    // checks above have to see the characters before it as well.
    const next = line.slice(at, found.from).search(/[\\`]/)
    if (next !== -1) {
      out += line.slice(at, at + next)
      at += next
      continue
    }

    out += line.slice(at, found.from)
    at = found.to
    open = found.close
  }

  return { text: out, inside: open }
}

/** The source with its comments gone, code left exactly as written.
 *
 *  A comment that had a whole line to itself leaves the line behind, empty. That
 *  is deliberate: a comment on its own line already ends the paragraph above it
 *  in CommonMark, so dropping the line as well would join two paragraphs that
 *  were never one.
 *
 *  What every renderer, every export and the glasses are handed, so nothing a
 *  writer wrote to themselves reaches a reader. */
export function withoutComments(source: string): string {
  // One scan of the bytes for a note that has none, which is nearly every note.
  if (!COMMENTS.some((one) => source.includes(one.open))) return source

  const lines = source.split('\n')
  const out: string[] = []
  let code = new CodeBlocks()
  let inside: string | null = null

  for (const line of lines) {
    // Inside a comment, what is left of the line is what the renderer is handed,
    // so that is what decides what the lines after it are.
    if (inside) {
      const stripped = stripLine(line, inside)
      inside = stripped.inside
      out.push(stripped.text)
      code.line(stripped.text)
      continue
    }

    const before = code.copy()
    const kind = code.line(line)
    if (kind === CODE) {
      out.push(line)
      continue
    }

    if (kind === OPENS) {
      // A comment in the info string would be the caption.
      const mark = code.fence ?? ''
      const opens = line.indexOf(mark) + mark.length
      out.push(line.slice(0, opens) + stripLine(line.slice(opens), null).text)
      continue
    }

    const stripped = stripLine(line, inside)
    inside = stripped.inside
    out.push(stripped.text)

    // A line that was nothing but a comment is a blank line to the renderer, which
    // ends a paragraph, so the line is read again as what is left of it.
    if (stripped.text !== line) {
      code = before
      code.line(stripped.text)
    }
  }

  return out.join('\n')
}
