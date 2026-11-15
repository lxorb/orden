import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { blockDecorations } from './blocks'
import { noReveal } from './reveal'

interface Drawn {
  from: number
  to: number
}

function drawnBlocks(state: EditorState, from: number, to: number): Drawn[] {
  const blocks = state.field(blockDecorations, false)
  if (!blocks) return []

  const found: Drawn[] = []
  blocks.decorations.between(from, to, (start, end, value) => {
    const spec = value.spec as { widget?: unknown } | null
    if (end > start && spec?.widget) found.push({ from: start, to: end })
  })
  return found
}

function farEdge(state: EditorState, head: number, down: boolean): number | null {
  if (!state.facet(noReveal)) return null
  const crossing = drawnBlocks(state, head, head).find((block) =>
    down ? block.from <= head && head < block.to : block.from < head && head <= block.to,
  )
  if (!crossing) return null
  return down ? crossing.to : crossing.from
}

export function edgeBeside(state: EditorState, head: number, down: boolean): number | null {
  const far = farEdge(state, head, down)
  if (far !== null) return far

  const line = state.doc.lineAt(head)
  const number = down ? line.number + 1 : line.number - 1
  if (number < 1 || number > state.doc.lines) return null

  const aim = state.doc.line(number)
  const [first] = drawnBlocks(state, aim.from, aim.to)
  if (!first) return null
  return down ? first.from : first.to
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
