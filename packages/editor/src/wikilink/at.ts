import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { isNoteTarget, type LinkKind, parseWikilink, type Wikilink } from '@nib/markdown/links'
import { enclosingNamed } from '../nodes'

/** Reading a link out of the document, wherever it is asked about.
 *
 *  Three places need the same answer - the decorations that draw a link, the
 *  modifier-click that follows one, and the hover that previews one - and each
 *  of them starts from a different thing: a syntax node, a document position, an
 *  element under the pointer. So the reading lives here and each of them asks. */

/** A link between notes, as it sits in the document. */
export interface LinkSpan extends Wikilink {
  kind: LinkKind
  /** The whole link, including its brackets. */
  from: number
  to: number
}

/** The wikilink a `Wikilink` node stands for. Null for a node whose text no
 *  longer parses as one, which a half-typed link is. */
export function wikilinkOfNode(state: EditorState, node: SyntaxNode): LinkSpan | null {
  const text = state.doc.sliceString(node.from, node.to)
  const embed = text.startsWith('!')
  const inner = text.slice(embed ? 3 : 2, -2)

  const link = parseWikilink(inner, embed)
  return link && { ...link, kind: 'wikilink', from: node.from, to: node.to }
}

/** The markdown link a `Link` or `Image` node stands for, when its target names
 *  a note rather than the web. `[label](notes/Other.md#a-heading)`. */
export function noteLinkOfNode(state: EditorState, node: SyntaxNode): LinkSpan | null {
  const url = node.getChild('URL')
  if (!url) return null

  const written = state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
  if (!isNoteTarget(written)) return null

  const hash = written.indexOf('#')
  const target = decode(hash === -1 ? written : written.slice(0, hash))
  const fragment = hash === -1 ? '' : written.slice(hash + 1)
  if (!target && !fragment) return null

  const open = node.firstChild
  const close = open?.nextSibling
  const label =
    open && close && open.name === 'LinkMark' && close.name === 'LinkMark'
      ? state.doc.sliceString(open.to, close.from)
      : ''

  // `#^a1b2c3` names a block and `#Some Heading` names a heading, in a markdown
  // link exactly as in a wikilink - Obsidian writes both that way, and so does
  // nib now that the Links setting can ask for markdown links; see
  // link-format.ts. Without this a block link written as a markdown link went
  // looking for a heading called `^a1b2c3` and found nothing.
  const block = fragment.startsWith('^') ? fragment.slice(1) : null

  return {
    target,
    heading: block === null ? fragment || null : null,
    block,
    alias: label,
    embed: node.name === 'Image',
    kind: 'markdown',
    from: node.from,
    to: node.to,
  }
}

function decode(target: string): string {
  try {
    return decodeURI(target)
  } catch {
    // Not valid encoding, so the characters are the name.
    return target
  }
}

/** Every spelling of a link this module reads. */
const LINKS = new Set(['Wikilink', 'Link', 'Image'])

/** The innermost link enclosing a position, looking to one side of it. */
function linkToward(state: EditorState, pos: number, side: 1 | -1): LinkSpan | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), LINKS)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkOfNode(state, node) : noteLinkOfNode(state, node)
}

/** The link at a document position, of either spelling. Used by the hover
 *  preview, which is handed a position and nothing else. Both sides are tried,
 *  because a position at a link's very edge resolves to whatever is next to it. */
export function linkAt(state: EditorState, pos: number): LinkSpan | null {
  return linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
}
