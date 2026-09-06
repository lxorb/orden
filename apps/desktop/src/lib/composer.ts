/** Taking notes apart and putting them together.
 *
 *  Three operations, and they are the three a note wants once its links work:
 *  merge this note into another one, split it in half at the caret, and lift a
 *  passage out of it into a note of its own. Each leaves a link where the text
 *  used to be, so nothing is ever lost from the note that was in front of you.
 *
 *  The arithmetic is here and it is pure - what the new note says, what is left
 *  behind, what the link reads - so it can be tested without a disk. Which files
 *  are written, and what is undone, is workspace's business. */

import { formatWikilink } from '@nib/markdown/links'
import { nameFromContent } from './note-name'

/** How two notes are joined: a rule at the seam, so the merge is visible in the
 *  text rather than only in the history. */
const SEAM = '\n\n---\n\n'

/** One note appended to another. Neither note's own text is touched; only the
 *  whitespace at the seam is settled, so a merge cannot leave a heading welded
 *  onto the end of a paragraph. */
export function merged(into: string, from: string): string {
  const head = into.replace(/\s+$/, '')
  const tail = from.replace(/^\s+/, '').replace(/\s+$/, '')

  if (!head) return tail
  if (!tail) return head
  return `${head}${SEAM}${tail}\n`
}

/** A wikilink to a note, by the name a link uses for it. Words to show only when
 *  there are some and they are not the name already. */
export function linkTo(name: string, shown?: string): string {
  return formatWikilink({
    target: name,
    heading: null,
    block: null,
    alias: !shown || shown === name ? null : shown,
    embed: false,
  })
}

export interface Split {
  /** What the note being split is left with, the link included. */
  kept: string
  /** What the new note says. */
  taken: string
  /** What the new note should be called, without an extension. */
  name: string
}

/** The note split at an offset: everything from there on becomes a note of its
 *  own, and a link to it is left in its place.
 *
 *  The caret is moved to the start of its own line first, because a split is
 *  about where a thought ends and not about where a word does. Null when there
 *  is nothing on the far side worth a note of its own. */
export function splitAt(text: string, at: number, fallback: string): Split | null {
  const start = lineStart(text, Math.max(0, Math.min(at, text.length)))
  const taken = text.slice(start).trim()
  if (!taken) return null

  const name = nameFromContent(taken) ?? fallback
  const kept = `${text.slice(0, start).replace(/\s+$/, '')}\n\n${linkTo(name)}\n`

  return { kept, taken: `${taken}\n`, name }
}

/** A selection lifted into a note of its own, with a link in its place. The
 *  selected words become the link's text when they are not the new note's name,
 *  so the sentence the passage was lifted out of still reads. */
export function extracted(text: string, from: number, to: number, fallback: string): Split | null {
  const taken = text.slice(from, to).trim()
  if (!taken) return null

  const name = nameFromContent(taken) ?? fallback
  const shown = oneLine(taken)
  const kept = text.slice(0, from) + linkTo(name, shown) + text.slice(to)

  return { kept, taken: `${taken}\n`, name }
}

/** A passage as something a link can show: its first line, without the markup
 *  that opened it, and nothing so long that it stops reading as a link. */
function oneLine(text: string): string {
  const first = text.split('\n')[0] ?? ''
  const words = first.replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '').trim()
  return words.length > 0 && words.length <= 60 ? words : ''
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
}
