import { EditorSelection, type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { rangeWrittenAsIs } from './code'
import { inside, spansLines } from './commands'
import { marksAcross } from './line-door'

const MARKS = new Set(['`', '*', '_', '~', '='])

export const wrapSelection = (): Extension =>
  Prec.high(
    EditorView.inputHandler.of((view, from, to, typed) => {
      if (typed.length !== 1 || !MARKS.has(typed)) return false

      const { state } = view
      if (state.readOnly || view.compositionStarted) return false

      const main = state.selection.main
      if (from !== main.from || to !== main.to) return false

      if (state.selection.ranges.some((range) => range.empty)) return false

      if (state.selection.ranges.some((range) => rangeWrittenAsIs(state, range))) return false

      if (state.selection.ranges.some((range) => spansLines(state, range))) {
        return marksAcross(typed, true)(view)
      }

      const wrapped = state.changeByRange((range) => {
        const { from, to } = inside(state, range.from, range.to)
        const forward = range.head >= range.anchor
        return {
          changes: [
            { from, insert: typed },
            { from: to, insert: typed },
          ],
          range: forward
            ? EditorSelection.range(from + 1, to + 1)
            : EditorSelection.range(to + 1, from + 1),
        }
      })

      view.dispatch(state.update(wrapped, { scrollIntoView: true, userEvent: 'input.type' }))
      return true
    }),
  )
