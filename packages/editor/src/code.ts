import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  return enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE) !== null
}

export function rangeInCode(state: EditorState, range: SelectionRange): boolean {
  return inCode(state, range.from) || inCode(state, range.to, -1)
}

const VERBATIM_BLOCKS = new Set([
  'FencedCode',
  'CodeBlock',
  'Table',
  'BlockMath',
  'FrontMatter',
  'HTMLBlock',
  'CommentBlock',
])

export function verbatimBlockAt(
  state: EditorState,
  line: { from: number; to: number },
): SyntaxNode | null {
  const tree = syntaxTree(state)
  return (
    enclosingNamed(tree.resolveInner(line.to, -1), VERBATIM_BLOCKS) ??
    enclosingNamed(tree.resolveInner(line.from, 1), VERBATIM_BLOCKS)
  )
}

export function inVerbatimBlock(state: EditorState, line: { from: number; to: number }): boolean {
  return verbatimBlockAt(state, line) !== null
}
