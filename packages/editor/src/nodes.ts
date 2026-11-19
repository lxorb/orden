import type { SyntaxNode } from '@lezer/common'

export function* enclosing(node: SyntaxNode): Generator<SyntaxNode> {
  for (let found: SyntaxNode | null = node; found; found = found.parent) yield found
}

export function enclosingNamed(node: SyntaxNode, wanted: ReadonlySet<string> | string): SyntaxNode | null {
  for (const found of enclosing(node)) {
    const hit = typeof wanted === 'string' ? found.name === wanted : wanted.has(found.name)
    if (hit) return found
  }

  return null
}

export function linkAddress(node: SyntaxNode): SyntaxNode | null {
  const opening = node.getChildren('LinkMark')[2]
  if (!opening) return null
  return node.getChildren('URL').find((url) => url.from >= opening.to) ?? null
}

export function linkBrackets(node: SyntaxNode): { open: SyntaxNode; close: SyntaxNode } | null {
  const [open, close] = node.getChildren('LinkMark')
  if (!open || !close || open.from !== node.from) return null
  return { open, close }
}
