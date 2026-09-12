/** The clip as a note.
 *
 *  Front matter first, so the note remembers where it came from and when, then
 *  the title as an H1, then the markdown. Nothing about a space or a folder is
 *  decided here: this is the file's contents and the name it wants, and
 *  `paths.ts` says where that name may go. */

import { withoutForbidden } from '@nib/markdown/paths'

import type { Origin } from './extract'

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

/** One line, however many the page wrote.
 *
 *  A title comes from the page - `og:title`, `<title>`, the words a link shows -
 *  and a page may put anything at all in it. A line break in there would end the
 *  front matter early, and everything after it would land in the note as
 *  markdown of the page's choosing; `---` on a line of its own is exactly the
 *  terminator. So no value in the block above a note is ever more than a line. */
function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** A YAML scalar. Plain where that is unambiguous, single quoted where it is
 *  not: a colon and a space open a mapping, a space and a hash open a comment,
 *  and a handful of characters mean something at the start of a value. Every
 *  value arrives as one line, so nothing here has to think about folding. */
function scalar(source: string): string {
  const value = oneLine(source)

  const ambiguous = !value || /:\s|:$|\s#/.test(value) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value)

  return ambiguous ? `'${value.replace(/'/g, "''")}'` : value
}

/** A member of a flow sequence, which is what `tags` is. The same rules, plus
 *  the characters that would end the member or the list itself. */
function member(source: string): string {
  const value = oneLine(source)
  return /[,[\]{}]/.test(value) ? `'${value.replace(/'/g, "''")}'` : scalar(value)
}

/** The block above the note. Four fields, always all four: a reader scanning a
 *  folder of clips should find the same shape in every one of them. */
export function frontMatter(origin: Origin, clipped: Date): string {
  const tags = origin.tags.map(member).join(', ')

  return [
    '---',
    `source: ${scalar(origin.url)}`,
    `title: ${scalar(origin.title)}`,
    `clipped: ${clipped.toISOString()}`,
    `tags: [${tags}]`,
    '---',
  ].join('\n')
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
 *  headline the body is checked against are the same words. */
export function noteFor(origin: Origin, markdown: string, clipped: Date): string {
  const title = oneLine(origin.title).slice(0, LONGEST_TITLE).trim() || UNTITLED
  const titled = { ...origin, title }

  const body = titled.kind === 'link' ? `<${titled.url}>` : withoutRepeatedTitle(markdown, title)

  return `${frontMatter(titled, clipped)}\n\n# ${title}\n\n${body}\n`
}
