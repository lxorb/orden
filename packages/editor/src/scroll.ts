import type { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function topLine(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  return view.lineBlockAtHeight(Math.max(0, top)).from
}

export const caretLine = (view: EditorView): number =>
  view.state.doc.lineAt(view.state.selection.main.head).number - 1

export const placeAt = (pos: number): StateEffect<unknown> | null =>
  pos > 0 ? EditorView.scrollIntoView(pos, { y: 'start' }) : null

export function showLine(view: EditorView, pos: number) {
  const place = placeAt(
    view.state.doc.lineAt(Math.min(Math.max(0, pos), view.state.doc.length)).from,
  )
  if (place) view.dispatch({ effects: place })
  else view.scrollDOM.scrollTop = 0
}
