import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { enclosingNamed } from './nodes'

const CLOSED = new Set(['Table', 'FencedCode', 'CodeBlock', 'BlockMath'])

const PICTURE = /^\s*(?:!\[[^\]]*\]\([^)]*\)|!\[\[[^\]]*\]\])\s*$/

export function tailOf(state: EditorState): { at: number; insert: string } | null {
  const { doc } = state
  const last = doc.line(doc.lines)
  if (!last.text.trim()) return null

  const end = syntaxTree(state).resolveInner(doc.length, -1)
  if (enclosingNamed(end, CLOSED)) return { at: doc.length, insert: '\n' }

  return PICTURE.test(last.text) ? { at: doc.length, insert: '\n\n' } : null
}

function open(view: EditorView): boolean {
  const tail = tailOf(view.state)
  if (!tail) return false

  view.dispatch({
    changes: { from: tail.at, insert: tail.insert },
    selection: EditorSelection.cursor(tail.at + tail.insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

export const openParagraphBelow: Command = (view) => (view.state.readOnly ? false : open(view))

export const openTailDown: Command = (view) => {
  if (view.state.selection.ranges.length > 1) return false

  const range = view.state.selection.main
  if (view.state.readOnly || !range.empty) return false
  if (view.state.doc.lineAt(range.head).number !== view.state.doc.lines) return false

  return open(view)
}

export function openTail(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (view.state.readOnly || event.button !== 0) return false

      const bottom = view.coordsAtPos(view.state.doc.length)?.bottom
      if (bottom === undefined || event.clientY <= bottom) return false

      if (!open(view)) return false
      event.preventDefault()
      view.focus()
      return true
    },
  })
}
