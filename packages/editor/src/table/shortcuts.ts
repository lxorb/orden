import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { insertLink, toggleWrap } from '../commands'
import { highlightSelection } from '../highlight'

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

export function inlineShortcut(event: KeyboardEvent): StateCommand | null {
  const mod = event.ctrlKey || event.metaKey

  if (event.altKey && event.shiftKey && !mod && event.code === 'Digit5') return toggleWrap('~~')
  if (!mod || event.altKey) return null

  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    if (key === 'h') return highlightSelection
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
