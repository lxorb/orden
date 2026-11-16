import { foldable, syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { headingLevel } from '../headings'
import { enclosing } from '../nodes'

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'math'
  | 'front-matter'
  | 'rule'
  | 'block'

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

  return { from: first.from, to: doc.lineAt(Math.min(node.to, doc.length)).to, kind }
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

export function blockAt(state: EditorState, pos: number): BlockSpan | null {
  const line = state.doc.lineAt(pos)
  const starting = blocksIn(state, line.from, line.to).find(
    (span) => state.doc.lineAt(span.from).from === line.from,
  )
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
