import { EditorSelection, type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { rangeInCode } from './code'

const MARKS = new Set(['`', '*', '_', '~', '='])

export function wrapSelection(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, typed) => {
      if (typed.length !== 1 || !MARKS.has(typed)) return false

      const { state } = view
      if (state.readOnly || view.compositionStarted) return false

      const main = state.selection.main
      if (from !== main.from || to !== main.to) return false

      if (state.selection.ranges.some((range) => range.empty)) return false

      if (state.selection.ranges.some((range) => rangeInCode(state, range))) return false

      const wrapped = state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: typed },
          { from: range.to, insert: typed },
        ],
        range: EditorSelection.range(range.anchor + 1, range.head + 1),
      }))

      view.dispatch(state.update(wrapped, { scrollIntoView: true, userEvent: 'input.type' }))
      return true
    }),
  )
}
