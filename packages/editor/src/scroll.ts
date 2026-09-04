import { EditorView } from '@codemirror/view'

/** The document position at the top of what is on screen. A steadier thing
 *  to remember than a pixel offset: line heights are estimates until they
 *  are measured, and change with the width of the window, so the same offset
 *  lands on a different line from one opening to the next. A position does
 *  not. */
export function topLine(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  return view.lineBlockAtHeight(Math.max(0, top)).from
}

/** Scrolls so that the line holding `pos` starts at the top. Applied by the
 *  view after it has measured itself, so it needs no frame of its own. */
export function showLine(view: EditorView, pos: number) {
  const at = Math.min(Math.max(0, pos), view.state.doc.length)
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
}
