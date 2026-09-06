import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { isNoteTarget, type LinkKind, parseWikilink, type Wikilink } from '@nib/markdown/links'

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

  return {
    target,
    heading: fragment || null,
    block: null,
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

/** The innermost link enclosing a position, looking to one side of it. */
function enclosing(state: EditorState, pos: number, side: 1 | -1): LinkSpan | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side)

  for (; node; node = node.parent) {
    if (node.name === 'Wikilink') return wikilinkOfNode(state, node)
    if (node.name === 'Link' || node.name === 'Image') return noteLinkOfNode(state, node)
  }

  return null
}

/** The link at a document position, of either spelling. Used by the hover
 *  preview, which is handed a position and nothing else. Both sides are tried,
 *  because a position at a link's very edge resolves to whatever is next to it. */
export function linkAt(state: EditorState, pos: number): LinkSpan | null {
  return enclosing(state, pos, 1) ?? enclosing(state, pos, -1)
}
