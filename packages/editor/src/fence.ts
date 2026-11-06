import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { captionIn, languageIn } from '@orden/markdown/code'
import { enclosingNamed } from './nodes'

function fenceInfo(state: EditorState, node: SyntaxNode): string {
  const info = node.getChild('CodeInfo')
  return info ? state.doc.sliceString(info.from, info.to).trim() : ''
}

export function fenceLanguage(state: EditorState, node: SyntaxNode): string {
  return languageIn(fenceInfo(state, node))
}

export function fenceCaption(state: EditorState, node: SyntaxNode): string {
  return captionIn(fenceInfo(state, node))
}

export function fenceCode(state: EditorState, node: SyntaxNode): string {
  return node
    .getChildren('CodeText')
    .map((piece) => state.doc.sliceString(piece.from, piece.to))
    .join('')
}

export function fenceCodeAt(state: EditorState, pos: number): string {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, 1), 'FencedCode')
  return node ? fenceCode(state, node) : ''
}
