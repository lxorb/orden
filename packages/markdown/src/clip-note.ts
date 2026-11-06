import { type FrontMatterRow, oneLine, writeFrontMatter } from './front-matter'
import { asWords } from './words'

export interface ClipOrigin {
  kind: 'page' | 'selection' | 'link'
  url: string
  title: string
  tags: string[]
}

const LONGEST_TITLE = 300

export const UNTITLED = 'Untitled'

export function clipTitle(title: string): string {
  return oneLine(title).slice(0, LONGEST_TITLE).trim() || UNTITLED
}

export function clipFrontMatter(
  origin: ClipOrigin,
  clipped: Date,
  more: readonly FrontMatterRow[] = [],
): string {
  return writeFrontMatter([
    ['source', origin.url],
    ['title', origin.title],
    ['clipped', clipped.toISOString()],
    ['tags', origin.tags],
    ...more,
  ])
}

function withoutRepeatedTitle(markdown: string, title: string): string {
  const heading = /^#{1,2}\s+(.+?)[ \t]*(?:\n|$)/.exec(markdown)
  if (!heading?.[1]) return markdown

  const said = heading[1].replace(/\\(.)/g, '$1')
  return said === title ? markdown.slice(heading[0].length).trimStart() : markdown
}

export function clipNoteText(
  origin: ClipOrigin,
  markdown: string,
  clipped: Date,
  more: readonly FrontMatterRow[] = [],
): string {
  const title = clipTitle(origin.title)
  const words = markdown.trim()
  const body =
    origin.kind === 'link' || words === '' ? `<${origin.url}>` : withoutRepeatedTitle(words, title)

  return `${clipFrontMatter({ ...origin, title }, clipped, more)}\n\n# ${asWords(title)}\n\n${body}\n`
}
