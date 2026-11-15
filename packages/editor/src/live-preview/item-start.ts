import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Line, type SelectionRange } from '@codemirror/state'
import { quietMarks } from './reveal'

const QUOTE = /^(?:[ \t]*>[ \t]?)*/
const ITEM = /^[ \t]*(?:([-*+])|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/
const HEADING = /^#{1,6}[ \t]+/

interface Run {
  from: number
  to: number
}

function markAt(state: EditorState, pos: number, name: string): boolean {
  return syntaxTree(state).resolveInner(pos, 1).name === name
}

function hiddenRun(state: EditorState, line: Line): Run | null {
  const quiet = state.facet(quietMarks)
  const quote = QUOTE.exec(line.text)?.[0] ?? ''
  const first = line.from + (line.text.length - line.text.trimStart().length)
  let start: number | null = quote && quiet && markAt(state, first, 'QuoteMark') ? 0 : null
  let at = quote.length

  const rest = line.text.slice(at)
  const item = ITEM.exec(rest)
  const heading = HEADING.exec(rest)
  if (item) {
    const mark = line.from + at + (rest.length - rest.trimStart().length)
    if ((item[1] || item[2]) && markAt(state, mark, 'ListMark')) {
      start ??= at
      at += item[0].length
    }
  } else if (heading && quiet && markAt(state, line.from + at, 'HeaderMark')) {
    start ??= at
    at += heading[0].length
  }

  if (start === null || at <= start) return null
  return { from: line.from + start, to: line.from + at }
}

function kept(before: EditorState, after: EditorState, range: SelectionRange, at: number) {
  const line = after.doc.lineAt(range.head)
  const run = hiddenRun(after, line)
  if (!run || range.head >= run.to || range.head < run.from) return range

  const was = (before.selection.ranges[at] ?? before.selection.main).head
  const sameLine = was >= line.from && was <= line.to
  if (!range.empty) {
    return sameLine && was > run.to ? EditorSelection.range(range.anchor, run.to) : range
  }
  if (sameLine && was === run.to && line.number > 1) return EditorSelection.cursor(line.from - 1)
  return EditorSelection.cursor(run.to)
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
