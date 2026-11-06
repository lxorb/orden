import { syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosing } from '../nodes'

export interface Side {
  items: SyntaxNode[]
  item: SyntaxNode | null
  indent: number
  moving: boolean
}

export function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

export function itemsAround(state: EditorState, pos: number): SyntaxNode[] {
  return [...enclosing(syntaxTree(state).resolveInner(pos, -1))].filter(
    (node) => node.name === 'ListItem',
  )
}

function itemStarting(state: EditorState, line: Line): SyntaxNode | null {
  let found: SyntaxNode | null = null
  for (const node of enclosing(
    syntaxTree(state).resolveInner(line.from + indentOf(line.text), 1),
  )) {
    if (node.name === 'ListItem' && node.from >= line.from) found = node
  }

  return found
}

export function above(state: EditorState, line: Line): Side {
  return { items: itemsAround(state, line.to), item: null, indent: 0, moving: false }
}

export function below(state: EditorState, line: Line, indent = indentOf(line.text)): Side {
  return { items: [], item: itemStarting(state, line), indent, moving: false }
}

function markerOf(state: EditorState, item: SyntaxNode): { number: number | null; tail: string } {
  const mark = item.getChild('ListMark')
  const text = mark ? state.doc.sliceString(mark.from, mark.to) : '-'
  const ordered = /^(\d+)([.)])$/.exec(text)

  return ordered
    ? { number: Number(ordered[1]), tail: ordered[2] ?? '.' }
    : { number: null, tail: text }
}

function joins(state: EditorState, upper: Side, lower: Side): lower is Side & { item: SyntaxNode } {
  if (!lower.item || !upper.items.length) return false

  const mark = markerOf(state, lower.item)
  if (mark.number === null || mark.number === 1) return true

  return upper.items.some((item) => {
    const other = markerOf(state, item)
    return other.number !== null && other.tail === mark.tail
  })
}

function loose(state: EditorState, list: SyntaxNode): boolean {
  const doc = state.doc
  return list
    .getChildren('ListItem')
    .slice(1)
    .some((item) => {
      const line = doc.lineAt(item.from).number
      return line > 1 && doc.line(line - 1).text.trim() === ''
    })
}

function listAt(state: EditorState, items: SyntaxNode[], indent: number): SyntaxNode | null {
  const doc = state.doc
  const item = items.find((one) => one.from - doc.lineAt(one.from).from <= indent) ?? items.at(-1)
  return item?.parent ?? null
}

function blank(existing: string | null): string {
  return existing !== null && existing.split('\n').length > 2 ? existing : '\n\n'
}

export function gap(state: EditorState, upper: Side, lower: Side, existing: string | null): string {
  if (!joins(state, upper, lower)) return blank(existing)

  const lists = [
    upper.moving ? null : listAt(state, upper.items, lower.indent),
    lower.moving ? null : lower.item.parent,
  ].filter((list) => list !== null)
  const hosts = lists.length ? lists : [lower.item.parent].filter((list) => list !== null)

  return hosts.some((list) => loose(state, list)) ? '\n\n' : '\n'
}
