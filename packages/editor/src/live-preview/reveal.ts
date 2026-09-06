import { type EditorState, Facet } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Holds every reveal shut, wherever the selection happens to be.
 *
 *  Reading mode sets it. What reveals syntax is the caret being inside the
 *  construct that owns it, and a document nobody can type into has no caret to
 *  put there - so a `**` that came back into view under a click would be
 *  answering a question the reader never asked. One switch rather than a
 *  check at each of the two dozen places that ask: everything below funnels
 *  through `overlaps`, so this is where the answer changes. */
export const noReveal = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

/** Typora reveals a construct's syntax characters when the caret is inside that
 *  construct - not the whole paragraph. So the reveal region for a syntax mark
 *  is its parent element: the `**` of one bold word stays hidden while you edit
 *  a different bold word on the same line. */
export function revealed(state: EditorState, node: SyntaxNode): boolean {
  const parent = node.parent ?? node
  return overlaps(state, parent.from, parent.to)
}

export function overlaps(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) return false
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

/** Block constructs reveal per line, which is what Typora does for `#` and `>`. */
export function lineRevealed(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return overlaps(state, line.from, line.to)
}
