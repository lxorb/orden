import { type Node, parseExpression } from './parse'

const COMPARE = new Set(['==', '!=', '<', '>', '<=', '>='])

const CONTAINS = new Set(['contains', 'containsAll', 'containsAny'])

function reads(node: Node, name: string): boolean {
  if (node.type === 'name') return node.name === name
  if (node.type === 'member') return node.name === name && isNote(node.object)
  if (node.type === 'index')
    return node.index.type === 'literal' && node.index.value === name && isNote(node.object)
  return false
}

const isNote = (node: Node) => node.type === 'name' && node.name === 'note'

export function renamedLiteral(source: string, property: string, from: string, to: string): string {
  const name = property.replace(/^note\./, '')
  let tree: Node
  try {
    tree = parseExpression(source)
  } catch {
    return source
  }
  const spans: [number, number][] = []
  const take = (node: Node) => {
    if (node.type === 'list') node.items.forEach(take)
    else if (node.type === 'literal' && node.value === from && node.at !== undefined)
      spans.push([node.at, node.end ?? node.at])
  }
  const walk = (node: Node): void => {
    switch (node.type) {
      case 'binary':
        if (COMPARE.has(node.op)) {
          if (reads(node.left, name)) take(node.right)
          else if (reads(node.right, name)) take(node.left)
        }
        walk(node.left)
        walk(node.right)
        return
      case 'call':
        if (
          node.callee.type === 'member' &&
          CONTAINS.has(node.callee.name) &&
          reads(node.callee.object, name)
        )
          node.args.forEach(take)
        walk(node.callee)
        node.args.forEach(walk)
        return
      case 'logical':
        walk(node.left)
        walk(node.right)
        return
      case 'unary':
        walk(node.argument)
        return
      case 'member':
        walk(node.object)
        return
      case 'index':
        walk(node.object)
        walk(node.index)
        return
      case 'list':
        node.items.forEach(walk)
        return
      case 'object':
        node.entries.forEach(([, value]) => walk(value))
        return
      case 'literal':
      case 'regex':
      case 'name':
        return
    }
  }
  walk(tree)
  return spans
    .sort((one, other) => other[0] - one[0])
    .reduce((text, [at, end]) => text.slice(0, at) + JSON.stringify(to) + text.slice(end), source)
}
