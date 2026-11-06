import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import { enclosingNamed } from './nodes'

const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  return enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE) !== null
}

export function rangeInCode(state: EditorState, range: SelectionRange): boolean {
  return inCode(state, range.from) || inCode(state, range.to, -1)
}
