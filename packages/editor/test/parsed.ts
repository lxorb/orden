import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export function parsed(state: EditorState, upTo = state.doc.length): EditorState {
  ensureSyntaxTree(state, upTo, 10_000)
  return state.update({}).state
}
