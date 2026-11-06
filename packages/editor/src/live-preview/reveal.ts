import { type EditorState, Facet } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export const noReveal = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

export const quietMarks = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

const QUIET = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'HighlightMark',
  'CodeMark',
  'HeaderMark',
  'QuoteMark',
])

function quiet(state: EditorState, node: SyntaxNode): boolean {
  if (!QUIET.has(node.name) || !state.facet(quietMarks)) return false
  return node.name !== 'CodeMark' || node.parent?.name === 'InlineCode'
}

export function blockMarkRevealed(state: EditorState, node: SyntaxNode): boolean {
  return !quiet(state, node) && lineRevealed(state, node.from)
}

export function revealed(state: EditorState, node: SyntaxNode): boolean {
  if (quiet(state, node)) return false
  const parent = node.parent ?? node
  return overlaps(state, parent.from, parent.to)
}

export function overlaps(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) return false
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

export function lineRevealed(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return overlaps(state, line.from, line.to)
}
