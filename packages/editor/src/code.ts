import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  return enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE) !== null
}

export function insideCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE)
  const span = node && enclosingNamed(node, 'InlineCode')
  if (!span) return node !== null

  const [open, close] = span.getChildren('CodeMark')
  return open !== undefined && close !== undefined && pos >= open.to && pos <= close.from
}

export function rangeInCode(state: EditorState, range: SelectionRange): boolean {
  return insideCode(state, range.from) || insideCode(state, range.to, -1)
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
