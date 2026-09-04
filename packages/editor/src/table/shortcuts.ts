import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { insertLink, toggleWrap } from '../commands'

/** A cell's text after one of the editor's inline commands ran on it. A cell
 *  is a document of one line, so the command that wraps a selection in the
 *  editor wraps it here too, and the two never disagree about what bold is. */
export function runInCell(
  command: StateCommand,
  text: string,
  from: number,
  to: number,
): { text: string; from: number; to: number } | null {
  const state = EditorState.create({ doc: text, selection: EditorSelection.range(from, to) })

  let result: { text: string; from: number; to: number } | null = null
  command({
    state,
    dispatch: (transaction) => {
      const { doc, selection } = transaction.state
      result = { text: doc.toString(), from: selection.main.from, to: selection.main.to }
    },
  })
  return result
}

/** The editor's inline shortcuts, for a key pressed in a cell. The bindings
 *  are the ones in the keymap; matched here by hand because the key never
 *  reaches the editor. */
export function inlineShortcut(event: KeyboardEvent): StateCommand | null {
  const mod = event.ctrlKey || event.metaKey

  if (event.altKey && event.shiftKey && !mod && event.code === 'Digit5') return toggleWrap('~~')
  if (!mod || event.altKey) return null

  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    if (key === 'h') return toggleWrap('==')
    if (event.code === 'Backquote') return toggleWrap('`')
    return null
  }

  switch (key) {
    case 'b':
      return toggleWrap('**')
    case 'i':
      return toggleWrap('*')
    case 'u':
      return toggleWrap('<u>', '</u>')
    case 'k':
      return insertLink
    default:
      return null
  }
}
