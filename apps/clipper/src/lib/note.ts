/** The clip as a note.
 *
 *  Front matter first, so the note remembers where it came from and when, then
 *  the title as an H1, then the markdown. Nothing about a space or a folder is
 *  decided here: this is the file's contents and the name it wants, and
 *  `paths.ts` says where that name may go. */

import { type FrontMatterRow, oneLine, writeFrontMatter } from '@nib/markdown/front-matter'
import { withoutForbidden } from '@nib/markdown/paths'

import type { Origin } from './extract'
import type { Filled } from './interpret/values'

/** The largest note the API takes; see `services/sync/src/notes.ts`. Checked
 *  here as well so an article that will never fit is refused before it is sent
 *  and before its pictures are uploaded. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024

/** What a note is called when the page offered no title at all. The same name
 *  the app gives a new note, and deliberately not translated: a file name is a
 *  path, and a path that changes with the language stops matching itself. */
const UNTITLED = 'Untitled'

const encoder = new TextEncoder()

export function byteLength(content: string): number {
  return encoder.encode(content).length
}

export function fits(content: string): boolean {
  return byteLength(content) <= MAX_NOTE_BYTES
}

/** The longest a page may name itself. A title is a line above an article, and
 *  a page that hands over a paragraph is handing over content in the wrong
 *  field. */
const LONGEST_TITLE = 300

/** How many tags a clip states. Both halves cap their own at eight - the page's
 *  keywords in `extract.ts`, the interpreter's in `interpret/values.ts` - and this
 *  is what the two together come to before a line of metadata has stopped being
 *  metadata. */
const MOST_TAGS = 12

/** The origin with what the interpreter had to say about it folded in.
 *
 *  Two of the properties a template may fill are ones the clip already has an
 *  answer for. The title is one: the page states it about itself and a model often
 *  states it better, without the site's name bolted on after a pipe, so a filled
 *  title replaces the page's everywhere the title is used at all - the block, the
 *  heading and the file's name - because a note with two titles is a note somebody
 *  has to reconcile. The tags are the other, and there they join rather than
 *  replace: the page published its own and the model read the words, and nothing
 *  true should be thrown away by having asked.
 *
 *  Every other property is a row of its own, which is `frontMatter`'s business. */
export function interpreted(origin: Origin, filled: readonly Filled[]): Origin {
  const said = new Map(filled.map((one) => [one.key, one.value]))

  const title = said.get('title')
  const listed = said.get('tags')
  const tags = [...origin.tags]

  for (const one of Array.isArray(listed) ? listed : []) {
    if (!tags.includes(one)) tags.push(one)
  }

  return {
    ...origin,
    title: typeof title === 'string' && title ? title : origin.title,
    tags: tags.slice(0, MOST_TAGS),
  }
}

/** The block above the note. The same four fields first, always all four and
 *  always in that order: a reader scanning a folder of clips should find the same
 *  shape at the top of every one of them, and whatever a template filled in comes
 *  under them in the order the template asked for it.
 *
 *  The origin is written as it is given: `title` and `tags` are `interpreted`'s to
 *  fold in and `noteFor` does that first, so the block, the heading and the file
 *  name are one decision rather than three that agree most of the time.
 *
 *  How a value is spelled - what is quoted, and how a line the page wrote is made
 *  one - is @nib/markdown/front-matter's, which is also what reads the block back
 *  in the app, and is what makes a model's answer safe to write down: a value
 *  carrying a colon, a `#`, or `---` on a line of its own comes out quoted rather
 *  than closing the block and continuing the note in somebody else's words. */
export function frontMatter(origin: Origin, clipped: Date, filled: readonly Filled[] = []): string {
  const rows: FrontMatterRow[] = [
    ['source', origin.url],
    ['title', origin.title],
    ['clipped', clipped.toISOString()],
    ['tags', origin.tags],
  ]

  for (const one of filled) {
    if (one.key !== 'title' && one.key !== 'tags') rows.push([one.key, one.value])
  }

  return writeFrontMatter(rows)
}

/** The extractor sometimes leaves the article's own headline at the top of the
 *  content, and the note is about to state it as an H1. One title is enough.
 *
 *  Compared with the escapes taken off, because the heading has been through
 *  the converter and the title has not: a headline ending in a full stop after
 *  a number comes back as `1\. ` and would otherwise never match. */
function withoutRepeatedTitle(markdown: string, title: string): string {
  const heading = /^#{1,2}\s+(.+?)[ \t]*(?:\n|$)/.exec(markdown)
  if (!heading?.[1]) return markdown

  const said = heading[1].replace(/\\(.)/g, '$1')
  return said === title ? markdown.slice(heading[0].length).trimStart() : markdown
}

/** A file name the title can be written as: what a filesystem refuses taken
 *  out, one line, and short enough that the path still fits inside a space. */
export function fileName(title: string): string {
  const name = withoutForbidden(title)
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim()

  return `${name || UNTITLED}.md`
}

/** The whole note. A clipped link has no content of its own, so it says the one
 *  thing it knows: the address, as a link somebody can follow.
 *
 *  The title is settled once, here, so the front matter, the heading and the
 *  headline the body is checked against are the same words - whether the page
 *  named it or a template's `title` did. */
export function noteFor(
  origin: Origin,
  markdown: string,
  clipped: Date,
  filled: readonly Filled[] = [],
): string {
  const whole = interpreted(origin, filled)
  const title = oneLine(whole.title).slice(0, LONGEST_TITLE).trim() || UNTITLED
  const titled = { ...whole, title }

  const body = titled.kind === 'link' ? `<${titled.url}>` : withoutRepeatedTitle(markdown, title)

  return `${frontMatter(titled, clipped, filled)}\n\n# ${title}\n\n${body}\n`
}
