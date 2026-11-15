import { foldedRanges } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { blockDecorations, openBlocksHere } from './blocks'
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

function folded(state: EditorState, from: number, to: number): boolean {
  let hidden = false
  foldedRanges(state).between(from, to, (start, end) => {
    if (start < to && end >= from) hidden = true
  })
  return hidden
}

function withinWrappedLine(view: EditorView, head: number, down: boolean): boolean {
  if (typeof view.moveVertically !== 'function') return false
  const line = view.state.doc.lineAt(head)
  const next = view.moveVertically(EditorSelection.cursor(head), down).head
  return next !== head && next >= line.from && next <= line.to
}

export function edgeBeside(state: EditorState, head: number, down: boolean): number | null {
  const far = farEdge(state, head, down)
  if (far !== null) return far

  const line = state.doc.lineAt(head)
  const number = down ? line.number + 1 : line.number - 1
  if (number < 1 || number > state.doc.lines) return null

  const aim = state.doc.line(number)
  if (folded(state, aim.from, aim.to)) return null
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
    if (
      farEdge(view.state, range.head, down) === null &&
      withinWrappedLine(view, range.head, down)
    ) {
      return false
    }
    if (edge === range.head && !view.state.facet(noReveal)) {
      view.dispatch({ effects: openBlocksHere.of(null) })
      return true
    }

    view.dispatch({
      selection: EditorSelection.cursor(edge),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

export const stepDown = step(true)

export const stepUp = step(false)

export const steppingKeymap = [
  { key: 'ArrowDown', run: stepDown },
  { key: 'ArrowUp', run: stepUp },
]
