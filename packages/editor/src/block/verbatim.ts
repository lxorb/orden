/** What in a note is typed exactly as it stands. */

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** Blocks whose lines are typed exactly as they stand: no shape is put on them, and
 *  a name on one is no name. */
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

/** Which lines between two positions belong to such a block, by number. */
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
