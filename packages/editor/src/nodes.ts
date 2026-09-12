/** Walking up the syntax tree from a position.
 *
 *  Twelve places asked the same question - what construct is this position inside
 *  of - and each wrote the walk out by hand. Two of them wrote it differently: a
 *  loop conditioned on `node.parent` stops before it has looked at the outermost
 *  node, so those two asked about every node but the last one. Today that last one
 *  is always the document itself, which no caller asks about, so the two answered
 *  the same as the other ten by luck rather than by construction; see nodes.test.ts.
 *
 *  A node's parents cross a language mount, so a token of JavaScript inside a
 *  fence still finds the fence above it, and the walk ends at the markdown
 *  document either way. */

import type { SyntaxNode } from '@lezer/common'

/** A node and every node above it, innermost first, the document last. */
export function* enclosing(node: SyntaxNode): Generator<SyntaxNode> {
  for (let found: SyntaxNode | null = node; found; found = found.parent) yield found
}

/** The innermost of those named one of `wanted`, or null where none is.
 *
 *  A single name as well as a set, because half of these questions are about one
 *  construct - is this a table, is this a fence - and a set of one reads as if the
 *  list were about to grow. */
export function enclosingNamed(
  node: SyntaxNode,
  wanted: ReadonlySet<string> | string,
): SyntaxNode | null {
  for (const found of enclosing(node)) {
    const hit = typeof wanted === 'string' ? found.name === wanted : wanted.has(found.name)
    if (hit) return found
  }

  return null
}
