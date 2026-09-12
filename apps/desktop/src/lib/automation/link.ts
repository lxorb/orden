/** Writing a `nib://` link, which is the other half of reading one.
 *
 *  Somebody who wants to link to a note from outside the app should not have to
 *  learn the scheme or hand-encode a path with a space in it, so the app writes
 *  one: a row in the palette copies a link to whatever is open. That row is also
 *  the whole of how anybody finds out the scheme exists. */

import { copyText } from '../clipboard'
import { headingAt, lineOf, scanHeadings } from '../outline'
import { relativeTo } from '../space-paths'
import { workspace } from '../workspace.svelte'

/** A link that opens one note of one space, and lands on a heading when there is
 *  one to land on.
 *
 *  Built through `URLSearchParams`, so a space called `Day job` and a note under
 *  `reading & notes/` come out as something that can be pasted anywhere without
 *  anybody thinking about encoding. */
export function linkTo(space: string, path: string, heading?: string | null): string {
  const said = new URLSearchParams({ space, path })
  if (heading) said.set('heading', heading)

  return `nib://open?${said.toString()}`
}

/** Copies a link to the note that is open, and answers whether there was one.
 *
 *  The heading the caret is in goes on it, because that is what somebody linking
 *  to a long note from a task manager means: a link to the note they are looking
 *  at, where they are looking. */
export async function copyNoteLink(): Promise<boolean> {
  const note = workspace.active
  const space = workspace.activeSpace
  const path = note?.path
  if (!note || !space || !path) return false

  await copyText(linkTo(space.name, relativeTo(space.root, path), headingAtCaret()))
  return true
}

/** The heading the caret sits under, or null when it is above the first one.
 *
 *  Through the outline's own three functions, which is what the panel and every
 *  jump already use: this cannot come to a different answer from the outline about
 *  which heading a line belongs to. Not through `workspace.headings`, which is the
 *  outline of whichever note the panel is showing and may be held on another. */
function headingAtCaret(): string | null {
  const note = workspace.active
  if (!note) return null

  // A tab that has never been scrolled or typed in has no remembered caret, and
  // the top of the note is where it would be.
  const headings = scanHeadings(note.doc)
  return headings[headingAt(headings, lineOf(note.doc, note.cursor ?? 0))]?.text ?? null
}
