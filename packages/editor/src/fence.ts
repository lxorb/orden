import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { captionIn, languageIn } from '@nib/markdown/code'

/** Reading a fenced code block back out of the document.
 *
 *  Three places want the same two things from a `FencedCode` node - the language
 *  it names and the code inside it - and each one used to ask for itself: the
 *  live preview, to colour the block and to draw the header's language, copy and
 *  run buttons; the block field, to draw a diagram; and run.ts, for Ctrl+Enter.
 *  Reading the code turns out not to be obvious, so it is done once, here. */

/** A fence's info string, trimmed. Empty for a fence that carries none. */
function fenceInfo(state: EditorState, node: SyntaxNode): string {
  const info = node.getChild('CodeInfo')
  return info ? state.doc.sliceString(info.from, info.to).trim() : ''
}

/** The language a fence's info string names. The empty string for a fence that
 *  names none.
 *
 *  Its first word, and not the whole of it: everything after the language is the
 *  block's caption. See code.ts in @nib/markdown, which is where both halves are
 *  read out of the string, since a page and a note have to agree about what a
 *  fence says. */
export function fenceLanguage(state: EditorState, node: SyntaxNode): string {
  return languageIn(fenceInfo(state, node))
}

/** The caption a fence carries: what the code is, said on the block's own top
 *  row. The empty string for a fence that says nothing but its language. */
export function fenceCaption(state: EditorState, node: SyntaxNode): string {
  return captionIn(fenceInfo(state, node))
}

/** The code inside a fenced block.
 *
 *  Every `CodeText` child joined, and not the first one alone. A fence whose
 *  lines carry a prefix - indented into a list item, or inside a blockquote -
 *  has that prefix outside the node, so lezer hands out one `CodeText` per line
 *  rather than one for the whole block. Asking for the first meant running,
 *  copying and drawing the first line of such a block and silently dropping the
 *  rest of it.
 *
 *  The gaps between the pieces are exactly the prefixes, so joining them with
 *  nothing in between is the code and only the code. */
export function fenceCode(state: EditorState, node: SyntaxNode): string {
  return node
    .getChildren('CodeText')
    .map((piece) => state.doc.sliceString(piece.from, piece.to))
    .join('')
}
