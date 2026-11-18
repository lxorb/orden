import { type EditorState, Facet, StateField } from '@codemirror/state'
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

export const blockMarkRevealed = (state: EditorState, node: SyntaxNode): boolean =>
  !quiet(state, node) && lineRevealed(state, node.from)

export function revealed(state: EditorState, node: SyntaxNode): boolean {
  if (quiet(state, node)) return false
  const parent = node.parent ?? node
  return overlaps(state, parent.from, parent.to)
}

export const foundMatch = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.selection) {
      if (!transaction.isUserEvent('select.search')) return null
      const { from, to } = transaction.selection.main
      return from < to ? { from, to } : null
    }
    if (!value || !transaction.docChanged) return value
    const from = transaction.changes.mapPos(value.from, 1)
    const to = transaction.changes.mapPos(value.to, -1)
    return from < to ? { from, to } : null
  },
})

export function overlaps(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) {
    const found = state.field(foundMatch, false)
    return !!found && found.from <= to && found.to >= from
  }
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

export function lineRevealed(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return overlaps(state, line.from, line.to)
}
