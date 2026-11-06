import type { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function topLine(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  return view.lineBlockAtHeight(Math.max(0, top)).from
}

export function caretLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number - 1
}

export function placeAt(pos: number): StateEffect<unknown> | null {
  return pos > 0 ? EditorView.scrollIntoView(pos, { y: 'start' }) : null
}

export function showLine(view: EditorView, pos: number) {
  const place = placeAt(
    view.state.doc.lineAt(Math.min(Math.max(0, pos), view.state.doc.length)).from,
  )
  if (place) view.dispatch({ effects: place })
  else view.scrollDOM.scrollTop = 0
}
