/** The note's headings, for the outline panel and for jumping about.
 *
 *  Read off the text rather than the editor's parse tree, because the outline
 *  is about the note the workspace holds and not about whichever note the one
 *  editor view happens to be showing. Kept here as a plain function so it can
 *  be tested without a document, and so the walk over the note is in one
 *  place: it is the whole text every time it runs, which is why the workspace
 *  only lets it run once the typing has paused. */

import { lines, slugify } from '@nib/markdown/links'

export interface Heading {
  level: number
  text: string
  line: number
}

const HEADING = /^(#{1,6})\s+(.*)$/

/** Every ATX heading in `text`, in order, skipping code and the front matter - a
 *  `# ` in a shell snippet or a YAML block is a comment, not a heading.
 *
 *  Which lines are code is `lines` in @nib/markdown/links, the reading the page and
 *  `[[Note#Heading]]` agree on: a block closes on its own mark only, so a `~~~` in a
 *  ``` block, or a ``` in a ```` block, is code being shown and not the end of it. */
export function scanHeadings(text: string): Heading[] {
  const found: Heading[] = []
  if (!text) return found

  for (const row of lines(text)) {
    if (row.code || row.matter) continue
    // Both groups are there whenever the pattern matches at all, so an empty
    // `hashes` is exactly the no-match case.
    const [, hashes = '', title = ''] = HEADING.exec(row.text) ?? []
    if (hashes) found.push({ level: hashes.length, text: title.trim(), line: row.line })
  }

  return found
}

/** Which line the offset `at` falls on, counting from zero. Only for a session
 *  written before the editor started saying so itself. */
export function lineOf(text: string, at: number): number {
  let line = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) line++
  return line
}

/** Which line the heading called `name` starts on, or null when the note has no
 *  such heading.
 *
 *  Matched by the words themselves and by the anchor they turn into, so
 *  `[[Note#Some Heading]]`, `[x](Note.md#some-heading)` and a bookmark kept on
 *  the row in the outline all reach the same line. */
export function lineOfHeading(headings: readonly Heading[], name: string): number | null {
  const wanted = name.trim().toLowerCase()
  const anchor = slugify(name)

  return (
    headings.find(
      (heading) => heading.text.toLowerCase() === wanted || slugify(heading.text) === anchor,
    )?.line ?? null
  )
}

/** Which of `headings` the caret sits under: the last one starting on or above
 *  its line, or -1 when the caret is above them all. */
export function headingAt(headings: readonly Heading[], line: number): number {
  let found = -1
  for (const [index, heading] of headings.entries()) {
    if (heading.line <= line) found = index
  }
  return found
}
