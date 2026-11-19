import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

export const inCode = (state: EditorState, pos: number, side: -1 | 1 = 1): boolean =>
  enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE) !== null

export function insideCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), CODE)
  const span = node && enclosingNamed(node, 'InlineCode')
  if (!span) return node !== null

  const [open, close] = span.getChildren('CodeMark')
  return open !== undefined && close !== undefined && pos >= open.to && pos <= close.from
}

function rangeInCode(state: EditorState, range: SelectionRange): boolean {
  return insideCode(state, range.from) || insideCode(state, range.to, -1)
}

const WRITTEN_AS_IS: Record<string, string> = {
  BlockMath: 'MathMark',
  InlineMath: 'MathMark',
  FrontMatter: 'FrontMatterMark',
}

const BARE_PAIR = /^[^$]?\$\$[^$]?$/

function betweenMarks(node: SyntaxNode, mark: string, pos: number): boolean {
  const marks = node.getChildren(mark)
  const open = marks[0]
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined
  return open !== undefined && pos >= open.to && (close === undefined || pos <= close.from)
}

function insideWrittenAsIs(state: EditorState, pos: number, side: -1 | 1): boolean {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), new Set(Object.keys(WRITTEN_AS_IS)))
  if (node) return betweenMarks(node, WRITTEN_AS_IS[node.name] ?? '', pos)

  const line = state.doc.lineAt(pos)
  const around = state.sliceDoc(Math.max(line.from, pos - 2), Math.min(line.to, pos + 2))
  return line.text.trim() !== '$$' && state.sliceDoc(pos - 1, pos + 1) === '$$' && BARE_PAIR.test(around)
}

export function rangeWrittenAsIs(state: EditorState, range: SelectionRange): boolean {
  return rangeInCode(state, range) || insideWrittenAsIs(state, range.from, 1) || insideWrittenAsIs(state, range.to, -1)
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

export function verbatimBlockAt(state: EditorState, line: { from: number; to: number }): SyntaxNode | null {
  const tree = syntaxTree(state)
  return (
    enclosingNamed(tree.resolveInner(line.to, -1), VERBATIM_BLOCKS) ??
    enclosingNamed(tree.resolveInner(line.from, 1), VERBATIM_BLOCKS)
  )
}

export function inVerbatimBlock(state: EditorState, line: { from: number; to: number }): boolean {
  return verbatimBlockAt(state, line) !== null
}
