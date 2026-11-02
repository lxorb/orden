/** The note as markdown, for somewhere that is not Orden.
 *
 *  Byte for byte what the editor holds, front matter and all, with two things
 *  changed and nothing else: a `[[wikilink]]` becomes a real relative link,
 *  because no other editor knows what the brackets mean, and a picture's `src`
 *  can be pointed at a copy sitting beside the file. Everything a plain markdown
 *  reader already understands is left exactly as it was written.
 *
 *  Pure. What a wikilink resolves to and where the pictures went are the
 *  caller's answers; this only writes them down. */

import {
  embedKind,
  embedSize,
  findLinks,
  type FoundLink,
  lines,
  shownText,
} from '@orden/markdown/links'
import { encodeTarget } from '../link-rewrite'

/** A stretch of the source, and what goes in its place. */
interface Edit {
  from: number
  to: number
  text: string
}

export interface MarkdownOptions {
  /** Where a wikilink points, as a path relative to the exported file. Null
   *  leaves it as the words it showed, which is what an export with nowhere to
   *  point already does everywhere else. */
  link?: (link: FoundLink) => string | null
  /** What a picture's `src` becomes - `assets/pic.png` beside the file, say.
   *  Null leaves the path the note wrote. */
  picture?: (src: string) => string | null
}

/** A source written bare: anything without a space, with its parentheses balanced, to the
 *  two levels deep anyone writes, as CommonMark reads one. */
const BARE = String.raw`(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.|\([^\s()]*\))*\))*`

/** What may follow a source: a title in any of markdown's three spellings. */
const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`

/** `![alt](src "title")`, with the parts kept apart so only the source moves. */
const PICTURE = new RegExp(String.raw`!\[([^\]]*)\]\(\s*(<[^>]*>|${BARE})(${TITLE})\s*\)`, 'g')

/** `[name]: src "title"`, which is where `![alt][name]` and `![name]` keep their source: on
 *  its own line, in a quote or not, and not a footnote's. */
const DEFINITION = new RegExp(
  String.raw`^([ >]*\[(?!\^)[^\]]+\]:[ \t]*)(<[^>]*>|[^\s<]\S*)(${TITLE})[ \t]*$`,
)

/** The link as markdown: the words it showed, pointing where it now points. */
function asLink(link: FoundLink, target: string): string {
  const anchor = link.heading ? `#${link.heading}` : ''
  const fragment = anchor ? encodeTarget(anchor) : ''

  // An embed loses its bang: a plain markdown reader cannot pull another note
  // into this one, and a link to it is the honest version of the same thing.
  return `[${shownText(link)}](${encodeTarget(target)}${fragment})`
}

/** A picture's new path as it has to be written: inside angle brackets when it
 *  was written that way, and when it holds a space, since a bare space would end
 *  the source and turn the rest of the path into a title. */
function asSource(path: string, written: string): string {
  return written.startsWith('<') || path.includes(' ') || !balanced(path) ? `<${path}>` : path
}

/** Whether a path's parentheses pair up, which is what lets one stand bare. */
function balanced(path: string): boolean {
  let open = 0
  for (const one of path) {
    if (one === '(') open++
    if (one === ')' && --open < 0) return false
  }
  return open === 0
}

/** Where every picture's source sits in the text, outside code: code as the links
 *  are read (`lines` in links.ts), so a block closes on its own mark only and a fence
 *  in a quote or a list item is code too. */
function pictureEdits(source: string, rename: (src: string) => string | null): Edit[] {
  const edits: Edit[] = []

  for (const { text: line, from: at, code } of lines(source)) {
    if (code) continue

    for (const match of line.matchAll(PICTURE)) {
      const written = match[2] ?? ''
      const bare = written.startsWith('<') ? written.slice(1, -1) : written
      const wanted = rename(bare)
      if (wanted === null || wanted === bare) continue

      const from = at + match.index + match[0].indexOf(written, match[1]?.length ?? 0)
      edits.push({ from, to: from + written.length, text: asSource(wanted, written) })
    }

    const definition = DEFINITION.exec(line)
    if (definition) {
      const written = definition[2] ?? ''
      const bare = written.startsWith('<') ? written.slice(1, -1) : written
      const wanted = rename(bare)
      if (wanted === null || wanted === bare) continue

      const from = at + (definition[1]?.length ?? 0)
      edits.push({ from, to: from + written.length, text: asSource(wanted, written) })
    }
  }

  return edits
}

/** `![[pic.png]]` as a plain markdown reader can draw it, where the picture has a place to
 *  be drawn from: a picture still, with the words the document reads under it. Null for
 *  anything else, which is an embed of a note and only ever a link. */
function pictureEmbed(link: FoundLink, rename: (src: string) => string | null): string | null {
  if (!link.embed || embedKind(link.target) !== 'image') return null

  const wanted = rename(link.target)
  if (wanted === null) return null

  const words = embedSize(link.alias) === null ? (link.alias ?? '') : ''
  return `![${words}](${asSource(wanted, '')})`
}

/** The note, rewritten. Edits are applied back to front so that each one's
 *  offsets are still the source's own when it is made. */
export function toMarkdown(source: string, options: MarkdownOptions = {}): string {
  const edits: Edit[] = []

  if (options.link || options.picture) {
    for (const found of findLinks(source)) {
      if (found.kind !== 'wikilink') continue

      const picture = options.picture ? pictureEmbed(found, options.picture) : null
      if (picture !== null) {
        edits.push({ from: found.from, to: found.to, text: picture })
        continue
      }
      if (!options.link) continue

      const target = options.link(found)
      edits.push({
        from: found.from,
        to: found.to,
        text: target === null ? shownText(found) : asLink(found, target),
      })
    }
  }

  if (options.picture) edits.push(...pictureEdits(source, options.picture))

  let out = source
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  }

  return out
}
