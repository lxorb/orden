import type { SyntaxNode } from '@lezer/common'

export function* enclosing(node: SyntaxNode): Generator<SyntaxNode> {
  for (let found: SyntaxNode | null = node; found; found = found.parent) yield found
}

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
