import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { type Node, parseExpression } from './parse'

const COMPARE = new Set(['==', '!=', '<', '>', '<=', '>='])
const CONTAINS = new Set(['contains', 'containsAll', 'containsAny'])
function reads(node: Node, name: string): boolean {
  if (node.type === 'name') return node.name === name
  if (node.type === 'member') return node.name === name && isNote(node.object)
  if (node.type === 'index') return node.index.type === 'literal' && node.index.value === name && isNote(node.object)
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
        if (node.callee.type === 'member' && CONTAINS.has(node.callee.name) && reads(node.callee.object, name))
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
const PLACES = new Set(['folder', 'path'])
const isFile = (node: Node) => node.type === 'name' && node.name === 'file'
const isPlace = (node: Node) => node.type === 'member' && PLACES.has(node.name) && isFile(node.object)
function children(node: Node): Node[] {
  switch (node.type) {
    case 'binary':
    case 'logical':
      return [node.left, node.right]
    case 'call':
      return [node.callee, ...node.args]
    case 'unary':
      return [node.argument]
    case 'member':
      return [node.object]
    case 'index':
      return [node.object, node.index]
    case 'list':
      return node.items
    case 'object':
      return node.entries.map(([, value]) => value)
    case 'literal':
    case 'regex':
    case 'name':
      return []
  }
}
function placeLiterals(node: Node): Node[] {
  const named: Node[] = []
  if (node.type === 'binary' && COMPARE.has(node.op)) {
    if (isPlace(node.left)) named.push(node.right)
    else if (isPlace(node.right)) named.push(node.left)
  }
  if (node.type === 'call' && node.callee.type === 'member') {
    const { name, object } = node.callee
    if ((name === 'inFolder' && isFile(object)) || (name === 'startsWith' && isPlace(object)))
      named.push(...node.args.slice(0, 1))
  }
  return [...named, ...children(node).flatMap(placeLiterals)]
}
type Stepping = (path: string) => string
const unmoved: Stepping = (path) => path
export function placedUnder(source: string, under: string, moved = unmoved): string {
  const folder = under.replace(/^\/+|\/+$/g, '')
  let tree: Node
  try {
    tree = parseExpression(source)
  } catch {
    return source
  }
  const spans = placeLiterals(tree).flatMap((node): [number, number, string][] => {
    if (node.type !== 'literal' || typeof node.value !== 'string' || node.at === undefined) return []
    const written = node.value.replace(/^\/+/, '')
    const now = moved(written)
    if (!folder && now === written) return []
    return [[node.at, node.end ?? node.at, folder ? (now ? `${folder}/${now}` : folder) : now]]
  })
  return spans
    .sort((one, other) => other[0] - one[0])
    .reduce((text, [at, end, value]) => text.slice(0, at) + JSON.stringify(value) + text.slice(end), source)
}
export function baseUnder(yaml: string, under: string, moved = unmoved): string {
  const document = parseDocument(yaml)
  if (document.errors.length || !isMap(document.contents)) return yaml
  const follow = (node: unknown): number => {
    if (isScalar(node) && typeof node.value === 'string') {
      const placed = placedUnder(node.value, under, moved)
      if (placed === node.value) return 0
      node.value = placed
      return 1
    }
    if (isSeq(node)) return node.items.reduce((sum: number, one) => sum + follow(one), 0)
    if (isMap(node)) return node.items.reduce((sum: number, pair) => sum + follow(pair.value), 0)
    return 0
  }
  const views = document.contents.get('views', true)
  const expressions = [
    document.contents.get('filters', true),
    document.contents.get('formulas', true),
    ...(isSeq(views) ? views.items.map((view) => (isMap(view) ? view.get('filters', true) : null)) : []),
  ]
  const changed = expressions.reduce((sum: number, one) => sum + follow(one), 0)
  return changed ? document.toString({ lineWidth: 0 }) : yaml
}
