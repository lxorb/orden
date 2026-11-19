import { foldable, syntaxTree } from '@codemirror/language'
import type { EditorState, Line, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { ownLine } from '@orden/markdown/links'
import { headingLevel } from '../headings'
import { enclosing } from '../nodes'

export type BlockKind =
  'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'table' | 'math' | 'front-matter' | 'rule' | 'block'

export interface BlockSpan {
  from: number
  to: number
  kind: BlockKind
}

const KINDS: Readonly<Record<string, BlockKind>> = {
  Paragraph: 'paragraph',
  Blockquote: 'quote',
  ListItem: 'list',
  FencedCode: 'code',
  CodeBlock: 'code',
  Table: 'table',
  BlockMath: 'math',
  FrontMatter: 'front-matter',
  HorizontalRule: 'rule',
  HTMLBlock: 'block',
  LinkReference: 'block',
  CommentBlock: 'block',
  FootnoteDef: 'block',
}

function kindOf(name: string): BlockKind | null {
  if (headingLevel(name) !== null) return 'heading'
  return KINDS[name] ?? null
}

function spanOf(state: EditorState, node: SyntaxNode, kind: BlockKind): BlockSpan {
  const doc = state.doc
  const first = doc.lineAt(node.from)

  if (kind === 'heading') {
    const section = foldable(state, first.from, first.to)
    return { from: first.from, to: section ? section.to : first.to, kind }
  }

  const to = doc.lineAt(Math.min(node.to, doc.length)).to
  const named = kind !== 'list' && (!node.parent || node.parent.name === 'Document')
  return { from: first.from, to: named ? ownIdEnd(doc, to) : to, kind }
}

export function ownIdEnd(doc: Text, to: number): number {
  let number = doc.lineAt(to).number + 1
  while (number <= doc.lines && !doc.line(number).text.trim()) number++
  if (number > doc.lines) return to
  const line = doc.line(number)
  return ownLine(line.text) ? line.to : to
}

export function blocksIn(state: EditorState, from: number, to: number): BlockSpan[] {
  const doc = state.doc
  const found: BlockSpan[] = []
  const taken = new Set<number>()

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const kind = kindOf(node.name)
      if (!kind) return true

      const span = spanOf(state, node.node, kind)
      const line = doc.lineAt(span.from).from
      const id = kind === 'paragraph' && ownLine(doc.lineAt(span.from).text)
      const named =
        id &&
        (found.some((one) => one.from < span.from && one.to >= span.to) ||
          namedAbove(state, doc.lineAt(span.from)) !== null)
      if (named) return false
      if (!taken.has(line)) {
        taken.add(line)
        found.push(span)
      }

      return kind === 'list'
    },
  })

  return found.sort((one, other) => one.from - other.from)
}

function withinQuote(state: EditorState, node: SyntaxNode): BlockSpan | null {
  const line = state.doc.lineAt(node.from).from
  let top = node
  for (let up = node.parent; up && up.name !== 'Blockquote'; up = up.parent) {
    if (kindOf(up.name) && state.doc.lineAt(up.from).from === line) top = up
  }
  const kind = kindOf(top.name)
  return kind ? spanOf(state, top, kind) : null
}

function namedAbove(state: EditorState, line: Line): BlockSpan | null {
  const above = writtenLine(state, line.number - 1, -1)
  if (!above) return null
  let top: SyntaxNode | null = null
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(above.to, -1); node;) {
    if (node.parent?.name === 'Document') top = node
    node = node.parent
  }
  if (!top) return null
  if (LISTS.has(top.name)) {
    const doc = state.doc
    const to = ownIdEnd(doc, doc.lineAt(Math.min(top.to, doc.length)).to)
    return to >= line.to ? { from: doc.lineAt(top.from).from, to, kind: 'list' } : null
  }
  const kind = kindOf(top.name)
  if (!kind || kind === 'heading' || kind === 'front-matter') return null
  const span = spanOf(state, top, kind)
  return span.to >= line.to ? span : null
}

const LISTS = new Set(['BulletList', 'OrderedList'])

export function withListIds(state: EditorState, spans: readonly BlockSpan[]): BlockSpan[] {
  const last = spans.at(-1)
  if (last?.kind !== 'list') return [...spans]
  const doc = state.doc
  let list: SyntaxNode | null = null
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(last.from, 1); node;) {
    if (node.parent?.name === 'Document') list = node
    node = node.parent
  }
  if (!list || !LISTS.has(list.name)) return [...spans]
  const start = doc.lineAt(list.from).from
  const end = doc.lineAt(Math.min(list.to, doc.length)).to
  const whole = last.to === end && spans.some((span) => span.from === start)
  return whole ? [...spans.slice(0, -1), { ...last, to: ownIdEnd(doc, end) }] : [...spans]
}

export function blockAt(state: EditorState, pos: number): BlockSpan | null {
  const line = state.doc.lineAt(pos)
  const owner = ownLine(line.text) ? namedAbove(state, line) : null
  if (owner) return owner
  const starting = blocksIn(state, line.from, line.to).find((span) => state.doc.lineAt(span.from).from === line.from)
  if (starting) return starting

  for (const node of enclosing(syntaxTree(state).resolveInner(pos, -1))) {
    const kind = kindOf(node.name)
    if (!kind) continue
    const first = state.doc.lineAt(node.from)
    if (first.from === line.from) return spanOf(state, node.node, kind)
    const outer = blockAt(state, first.from)
    const nested = outer?.kind === 'quote' && kind !== 'quote' && outer.from !== first.from
    return nested ? withinQuote(state, node.node) : outer
  }

  return null
}

const UNWRITTEN = /^(?:[ \t]*>)*[ \t]*$/

export function writtenLine(state: EditorState, number: number, delta: -1 | 1): Line | null {
  const doc = state.doc

  for (let at = number; at >= 1 && at <= doc.lines; at += delta) {
    const line = doc.line(at)
    if (line.text.replace(UNWRITTEN, '')) return line
  }

  return null
}
