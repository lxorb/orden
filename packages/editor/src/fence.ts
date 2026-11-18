import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { captionIn, languageIn } from '@orden/markdown/code'
import { enclosingNamed } from './nodes'

function fenceInfo(state: EditorState, node: SyntaxNode): string {
  const info = node.getChild('CodeInfo')
  return info ? state.doc.sliceString(info.from, info.to).trim() : ''
}

export const fenceLanguage = (state: EditorState, node: SyntaxNode): string =>
  languageIn(fenceInfo(state, node))

export const fenceCaption = (state: EditorState, node: SyntaxNode): string =>
  captionIn(fenceInfo(state, node))

export const fenceCode = (state: EditorState, node: SyntaxNode): string =>
  node
    .getChildren('CodeText')
    .map((piece) => state.doc.sliceString(piece.from, piece.to))
    .join('')

const CONTAINER_LEAD = /^(?:[ \t]*>)*[ \t]*/
const CONTENT_START = /^(?:[ \t]*(?:>|(?:[-*+]|\d+[.)])(?=[ \t])))*[ \t]*/
const FENCE_LINE = /^(?:[ \t]*(?:>|(?:[-*+]|\d+[.)])(?=[ \t])))*[ \t]*(?:`{3,}|~{3,})/

export function opensFence(text: string): boolean {
  return FENCE_LINE.test(text)
}

export function fenceNear(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state)
  const line = state.doc.lineAt(pos)
  const start = line.from + (CONTENT_START.exec(line.text)?.[0].length ?? 0)
  for (const [at, side] of [
    [pos, -1],
    [pos, 1],
    [start, 1],
  ] as const) {
    const node = enclosingNamed(tree.resolveInner(at, side), 'FencedCode')
    if (node) return node
  }
  return null
}

export function fenceLead(state: EditorState, node: SyntaxNode): string {
  const close = state.doc.lineAt(Math.min(node.to, state.doc.length))
  return CONTAINER_LEAD.exec(close.text)?.[0] ?? ''
}

export function fenceCodeAt(state: EditorState, pos: number): string {
  const node = fenceNear(state, pos)
  return node ? fenceCode(state, node) : ''
}
