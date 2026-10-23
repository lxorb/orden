/** One property's literal renamed in an expression, and nobody else's.
 *
 *  A board's option renamed has to follow into the filters that name it, but the
 *  same words may be another property's value too: `status != "Low" && priority ==
 *  "Low"` renames only the first. So the expression is read into its tree and only a
 *  string compared with the property, or passed to its `contains`, is rewritten;
 *  the rest of the words stay exactly as they were written. */

import { type Node, parseExpression } from './parse'

/** The operators that compare one side with the other. */
const COMPARE = new Set(['==', '!=', '<', '>', '<=', '>='])

/** The methods whose argument is a value of their receiver. */
const CONTAINS = new Set(['contains', 'containsAll', 'containsAny'])

/** Whether a node reads the property: `status`, `note.status` or `note["status"]`. */
function reads(node: Node, name: string): boolean {
  if (node.type === 'name') return node.name === name
  if (node.type === 'member') return node.name === name && isNote(node.object)
  if (node.type === 'index')
    return node.index.type === 'literal' && node.index.value === name && isNote(node.object)
  return false
}

const isNote = (node: Node) => node.type === 'name' && node.name === 'note'

/** `source` with each string `from` compared with `property` written as `to`. An
 *  expression that does not parse is left as it is, since nothing in it can be told apart. */
export function renamedLiteral(source: string, property: string, from: string, to: string): string {
  const name = property.replace(/^note\./, '')
  let tree: Node
  try {
    tree = parseExpression(source)
  } catch {
    return source
  }
  const spans: [number, number][] = []
  // The literal itself, or each item of a list of them (`containsAny(["a", "b"])`).
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
  // From the end back, so the places of the spans still to replace do not move.
  return spans
    .sort((one, other) => other[0] - one[0])
    .reduce((text, [at, end]) => text.slice(0, at) + JSON.stringify(to) + text.slice(end), source)
}
