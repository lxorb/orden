/** One note read into what the link index holds.
 *
 *  The same shape the desktop's `scan_links` returns, and the same reading: the
 *  browser's stand-in for that command uses this for every note in its store, and
 *  the index uses it again for the one note that has just been saved. One
 *  function, so a note re-read after a save cannot come back looking different
 *  from the same note read by the first scan. */

import { frontMatterList, frontMatterValue } from '@nib/markdown/front-matter'
import { blockIds, findLinks, headingsOf, type LinkKind } from '@nib/markdown/links'
import { readCanvas } from './canvas/format'
import { ICON_COLOUR_KEY, ICON_KEY } from './icons'

/** One link out of a note. Named for the shape below rather than for a caller:
 *  everything outside reads a whole note, never one of its links. */
interface ScannedLink {
  kind: LinkKind
  target: string
  heading: string | null
  block: string | null
  alias: string | null
  embed: boolean
  /** The line it sits on, counting from zero. */
  line: number
  /** The line itself, so a row in the Links panel reads like the note. */
  text: string
}

export interface ScannedNote {
  /** Relative to the space, `/`-separated, which is how a link speaks of it. */
  path: string
  /** The file's name without its extension, which is what a link uses. */
  name: string
  headings: string[]
  blocks: string[]
  links: ScannedLink[]
  /** What the note's front matter says it wears in the file list, as written, or
   *  null where it says nothing. Read in this pass rather than in one of its own:
   *  every row of the tree wants it, and the space has already been read here. */
  icon: string | null
  /** The colour a stroked icon is drawn in, as written, or null. A second key
   *  rather than part of the first so that another app reading the note still finds
   *  the icon; see chosen-icon.ts. */
  iconColor: string | null
  /** The other names the note gave itself, as its front matter lists them.
   *  Read on this pass for the same reason the icon is: the space is already
   *  being read. */
  aliases: string[]
}

export interface SpaceLinks {
  notes: ScannedNote[]
  /** Everything in the space that is not a note, so `![[picture.png]]` finds a
   *  picture wherever it lives, the way Obsidian does. */
  files: string[]
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** How much of a line a row shows, matched to what a search hit shows. */
const CONTEXT = 200

export function scanNote(path: string, content: string): ScannedNote {
  return {
    path,
    name: (path.split('/').pop() ?? path).replace(MARKDOWN, ''),
    headings: headingsOf(content),
    blocks: blockIds(content).map((one) => one.id),
    icon: frontMatterValue(content, ICON_KEY),
    iconColor: frontMatterValue(content, ICON_COLOUR_KEY),
    aliases: frontMatterList(content, 'aliases'),
    links: findLinks(content).map((link) => ({
      kind: link.kind,
      target: link.target,
      heading: link.heading,
      block: link.block,
      alias: link.alias,
      embed: link.embed,
      line: lineAt(content, link.from),
      text: contextAt(content, link.from),
    })),
  }
}

/** A canvas read into the same shape a note is.
 *
 *  A canvas has no words of its own worth indexing - the JSON is a drawing, not
 *  prose - but the notes its file nodes name are links out of it, so the Links
 *  panel can say what a canvas points at and a note can say which canvas points
 *  at it. Each file node becomes one link written the way a wikilink is, which is
 *  how the index resolves a path relative to the space.
 *
 *  Headings and blocks stay empty: nothing points into a canvas, only at it. */
export function scanCanvas(path: string, content: string): ScannedNote {
  const canvas = readCanvas(content)

  return {
    path,
    // The extension is part of a canvas's name, the way it is for a PDF: a link
    // to one is written `[[Board.canvas]]`.
    name: path.split('/').pop() ?? path,
    headings: [],
    blocks: [],
    // Under the `nib` key that already carries the ink, since a JSON file has no
    // front matter: the same value a note keeps under `icon:`, read by the same
    // icons.ts. See canvas.ts for why it lives in the file rather than beside it.
    icon: canvas.icon ?? null,
    iconColor: canvas.iconColor ?? null,
    // No other name for itself, though: an alias is something a link is written
    // with, and nothing writes `[[Board]]` for a canvas.
    aliases: [],
    links: canvas.nodes
      .filter((node): node is Extract<typeof node, { type: 'file' }> => node.type === 'file')
      .map((node) => ({
        kind: 'wikilink' as const,
        target: node.file,
        // A file node's subpath is a heading or a block, written with the `#` a
        // wikilink writes it with; a link into neither has null for both.
        heading: node.subpath?.startsWith('#^') === false ? node.subpath.slice(1) : null,
        block: node.subpath?.startsWith('#^') === true ? node.subpath.slice(2) : null,
        alias: null,
        embed: false,
        // A canvas has no lines, so every row reads as the card it came from.
        line: 0,
        text: node.file,
      })),
  }
}

/** Which line an offset falls on, counting from zero. */
function lineAt(text: string, at: number): number {
  let line = 0
  for (let found = text.indexOf('\n'); found !== -1 && found < at;) {
    line++
    found = text.indexOf('\n', found + 1)
  }
  return line
}

/** The line an offset sits on, as the context a row is read in. */
function contextAt(text: string, at: number): string {
  const from = text.lastIndexOf('\n', at) + 1
  const end = text.indexOf('\n', at)
  return text
    .slice(from, end === -1 ? text.length : end)
    .trim()
    .slice(0, CONTEXT)
}
