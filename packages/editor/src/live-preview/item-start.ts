import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'

const HIDDEN_MARKER = /^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/

function wordsStart(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos)
  const marker = HIDDEN_MARKER.exec(line.text)?.[0]
  if (!marker) return null
  const indent = line.text.length - line.text.trimStart().length
  const mark = syntaxTree(state).resolveInner(line.from + indent, 1)
  if (mark.name !== 'ListMark') return null
  return line.from + marker.length
}

function kept(before: EditorState, after: EditorState, range: SelectionRange, at: number) {
  const was = before.selection.ranges[at] ?? before.selection.main
  const start = wordsStart(after, range.head)
  if (start === null || range.head >= start) return range
  if (after.doc.lineAt(was.head).number !== after.doc.lineAt(range.head).number) return range
  if (was.head <= start) return range
  return range.empty ? EditorSelection.cursor(start) : EditorSelection.range(range.anchor, start)
}

export const itemStart = EditorState.transactionFilter.of((transaction) => {
  if (transaction.docChanged || !transaction.selection || !transaction.isUserEvent('select')) {
    return transaction
  }
  const { startState, newSelection } = transaction
  const ranges = newSelection.ranges.map((range, at) =>
    kept(startState, transaction.state, range, at),
  )
  if (ranges.every((range, at) => range === newSelection.ranges[at])) return transaction
  return [
    transaction,
    {
      selection: EditorSelection.create(ranges, newSelection.mainIndex),
      sequential: true,
    },
  ]
})
