/** Whether a position in the document is code rather than prose.
 *
 *  Two features ask the same question and have to get the same answer: the
 *  ligature scope, which may draw its glyphs in code only, and the marks that
 *  wrap a selection, which type as themselves inside a fence. A second list
 *  would drift, and the drift would show as a `*` that wraps in one place and
 *  not in the other. */

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Every node a piece of code is made of: a fenced block, an indented block,
 *  an inline span, and the marks and the language name that go with them.
 *
 *  A fence whose language the app knows mounts that language's own tree on the
 *  `CodeText` inside it, and a node's parents cross the mount, so a token of
 *  JavaScript still finds the fence above it. */
const CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'FencedCode', 'CodeBlock'])

/** `side` is which way to look when the position sits between two nodes, the
 *  same as CodeMirror's: 1 is the node starting here, -1 the one ending here. */
export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
    node;
    node = node.parent
  ) {
    if (CODE.has(node.name)) return true
  }

  return false
}
