import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import { enclosingNamed } from './nodes'

const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

export const inCode = (state: EditorState, pos: number, side: -1 | 1 = 1): boolean =>
  enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE) !== null

export const rangeInCode = (state: EditorState, range: SelectionRange): boolean =>
  inCode(state, range.from) || inCode(state, range.to, -1)
