import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

const VERBATIM = new Set([
  'FencedCode',
  'CodeBlock',
  'Table',
  'BlockMath',
  'FrontMatter',
  'HorizontalRule',
  'HTMLBlock',
  'CommentBlock',
  'LinkReference',
])

export function verbatimLines(state: EditorState, from: number, to: number): Set<number> {
  const found = new Set<number>()

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (!VERBATIM.has(node.name)) return true

      const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number
      for (let at = state.doc.lineAt(node.from).number; at <= last; at++) found.add(at)
      return false
    },
  })

  return found
}
