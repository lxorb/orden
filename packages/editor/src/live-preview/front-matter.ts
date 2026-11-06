import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@orden/markdown/edits'
import { frontMatterBlock } from '@orden/markdown/front-matter'

export interface FrontMatterSpan {
  end: number
  after: number
}

export function frontMatterSpan(state: EditorState): FrontMatterSpan | null {
  const first = syntaxTree(state).topNode.firstChild
  if (first?.name !== 'FrontMatter' || first.from !== 0) return null
  if (first.getChildren('FrontMatterMark').length < 2) return null

  const end = state.doc.lineAt(first.to).to
  return { end, after: Math.min(end + 1, state.doc.length) }
}

export function applied(source: string, edit: TextEdit): string {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

export function clearOfBlock(view: EditorView, after: string): { anchor: number } | undefined {
  const was = frontMatterBlock(view.state.doc.toString())
  if (!was || view.state.selection.main.head >= was.to) return undefined

  const block = frontMatterBlock(after)
  return block ? { anchor: Math.min(block.to, after.length) } : undefined
}
