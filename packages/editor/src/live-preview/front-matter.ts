import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@orden/markdown/edits'
import { frontMatterBlock } from '@orden/markdown/front-matter'

export function applied(source: string, edit: TextEdit): string {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

export function clearOfBlock(view: EditorView, after: string): { anchor: number } | undefined {
  const was = frontMatterBlock(view.state.doc.toString())
  if (!was || view.state.selection.main.head >= was.to) return undefined

  const block = frontMatterBlock(after)
  return block ? { anchor: Math.min(block.to, after.length) } : undefined
}
