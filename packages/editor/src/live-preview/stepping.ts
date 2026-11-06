import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { blockDecorations } from './blocks'

export function edgeBeside(state: EditorState, head: number, down: boolean): number | null {
  const blocks = state.field(blockDecorations, false)
  if (!blocks) return null

  const line = state.doc.lineAt(head)
  const number = down ? line.number + 1 : line.number - 1
  if (number < 1 || number > state.doc.lines) return null

  const aim = state.doc.line(number)
  let edge: number | null = null
  blocks.decorations.between(aim.from, aim.to, (from, to, value) => {
    const spec = value.spec as { widget?: unknown } | null
    if (to <= from || !spec?.widget) return undefined

    edge = down ? from : to
    return false
  })

  return edge
}

function step(down: boolean): Command {
  return (view) => {
    const range = view.state.selection.main
    if (!range.empty) return false

    const edge = edgeBeside(view.state, range.head, down)
    if (edge === null) return false

    view.dispatch({
      selection: EditorSelection.cursor(edge),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

export const steppingKeymap = [
  { key: 'ArrowDown', run: step(true) },
  { key: 'ArrowUp', run: step(false) },
]
