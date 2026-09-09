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
 *  rather than running a pattern over it. */

/** The two ways a comment is written. `%%` opens and closes with the same
 *  characters, which the scan below does not care about: it looks for the
 *  opening it is not inside one, and for the closing when it is. */
const COMMENTS = [
  { open: '<!--', close: '-->' },
  { open: '%%', close: '%%' },
] as const

/** A fence line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Whether a line inside a fence opened with `mark` closes it: the same
 *  character, at least as many of them, and nothing after them. */
function closes(line: string, mark: string): boolean {
  const found = FENCE.exec(line)?.[1]
  if (!found) return false
  return (
    found.startsWith(mark.charAt(0)) &&
    found.length >= mark.length &&
    !line.trim().slice(found.length)
  )
}

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

    // A backtick run is inline code up to the next run of the same length, and
    // whatever is between them is shown rather than read. An unclosed run is not
    // code at all, so the scan carries on past it.
    if (line[at] === '`') {
      const marks = /^`+/.exec(line.slice(at))?.[0] ?? '`'
      const close = line.indexOf(marks, at + marks.length)
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

    // Only up to the comment, and then round again: the backtick check above has
    // to see the characters between two comments as well.
    const next = line.slice(at, found.from).indexOf('`')
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
  let fence: string | null = null
  let inside: string | null = null

  for (const line of lines) {
    if (fence !== null) {
      out.push(line)
      if (closes(line, fence)) fence = null
      continue
    }

    if (!inside) {
      const mark = FENCE.exec(line)?.[1]
      if (mark) {
        out.push(line)
        fence = mark
        continue
      }
    }

    const stripped = stripLine(line, inside)
    inside = stripped.inside
    out.push(stripped.text)
  }

  return out.join('\n')
}
