/** A way out from under whatever ends the note.
 *
 *  A table, a code block, a formula or a picture at the very end of a note leaves
 *  nowhere to stand: the block is the last thing in the document, so there is no
 *  line below it to move to and no empty space to click in. Typora makes the line
 *  for you, and so does this - an arrow down or a click under the block puts a
 *  paragraph there and the caret in it.
 *
 *  The blank line the picture case adds is not decoration. Words written directly
 *  under `![a](b)` are the same paragraph as the picture in markdown, so a note
 *  that gained a line but not a blank one would have gained a caption. A block
 *  that closes itself - a fence, a formula, a table - needs only the one line. */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { enclosingNamed } from './nodes'

/** Blocks that close themselves, and so end the document with no line after. */
const CLOSED = new Set(['Table', 'FencedCode', 'CodeBlock', 'BlockMath'])

/** A line that is one picture and nothing else, in either spelling. */
const PICTURE = /^\s*(?:!\[[^\]]*\]\([^)]*\)|!\[\[[^\]]*\]\])\s*$/

/** What it would take to open a line under whatever ends the note, or null when
 *  the caret can already get there. */
export function tailOf(state: EditorState): { at: number; insert: string } | null {
  const { doc } = state
  const last = doc.line(doc.lines)
  // A note that already ends in an empty line has the place to stand.
  if (!last.text.trim()) return null

  const end = syntaxTree(state).resolveInner(doc.length, -1)
  if (enclosingNamed(end, CLOSED)) return { at: doc.length, insert: '\n' }

  return PICTURE.test(last.text) ? { at: doc.length, insert: '\n\n' } : null
}

/** Makes the paragraph and puts the caret in it. */
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

/** Opens the line, from wherever the caret already is. Used by the picture's own
 *  arrow keys, which see a selected picture before this does. */
export const openParagraphBelow: Command = (view) => (view.state.readOnly ? false : open(view))

/** Down from the last line of the note. Not a shortcut anybody chose: the arrow
 *  keys belong to the text, which is what the settings list says of them. */
export const openTailDown: Command = (view) => {
  // With several cursors the key belongs to all of them, not to a paragraph
  // opened under the last line for one.
  if (view.state.selection.ranges.length > 1) return false

  const range = view.state.selection.main
  if (view.state.readOnly || !range.empty) return false
  // Only from the last line: an arrow anywhere above it has a line to go to, and
  // taking the key there would stop the caret one line short.
  if (view.state.doc.lineAt(range.head).number !== view.state.doc.lines) return false

  return open(view)
}

/** A click in the space under the block that ends the note. */
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
